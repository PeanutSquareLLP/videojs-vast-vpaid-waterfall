(function (videojs)
{
	'use strict';

	var defaults = {
		markers: true,
		flashWrapperPath: "/VPAIDFlash.swf",
		debug: false
	};

	var registerPlugin = videojs.registerPlugin || videojs.plugin;

	var vastWaterfall = function vastWaterfall(options)
	{
		var player = this;

		options = videojs.mergeOptions(defaults, options);

		var markers = [];

		var playedMidrolls = [];
		var closestMidroll = 0;

		var lastTime = 0;
		
		var techScreen = player.el().querySelector(".vjs-tech");
		
		var vpaidContainer = document.createElement("div");
		vpaidContainer.className = "vjs-vpaid-wrapper";
		player.el().insertBefore(vpaidContainer, player.controlBar.el());

		var vastTracker;

		if (!player.ads) return;
		player.ads(options);

		if (options.midroll)
		{
			for (var m = 0; m < options.midroll.length; m++)
			{
				playedMidrolls[options.midroll[m].time] = false;
			}

			player.on("loadedmetadata", function () {
				debugLog("Ready");
				for(var m = 0; m < options.midroll.length; m++)
				{
					if(options.markers && !markers.includes(options.midroll[m].time))
					{
						markers.push(options.midroll[m].time);

						var newMarker = document.createElement("div");
						newMarker.className = "vjs-midroll-marker";
						newMarker.style.left = options.midroll[m].time / player.duration() * 100 + "%";
						player.el().querySelector('.vjs-progress-holder').appendChild(newMarker);
					}
				}
			});

			player.on('timeupdate', function (event)
			{
				if (player.ads.isInAdMode()) return;

				var opportunity;

				closestMidroll = Math.min.apply(Math, options.midroll.map(midroll => midroll.time));

				for(var m = 0; m < options.midroll.length; m++)
				{
					if (player.currentTime() > options.midroll[m].time) closestMidroll = options.midroll[m].time;
				}

				if(playedMidrolls[closestMidroll]) return;

				if(lastTime)
				{
					opportunity = player.currentTime() > closestMidroll && lastTime < closestMidroll;
				}

				lastTime = player.currentTime();
				if(opportunity) prepareAds("midroll");
			});
		}

		player.on('contentchanged', function ()
		{
			player.trigger('adsready');
		});

		player.on('readyforpreroll', function ()
		{
			if (options.preroll) prepareAds("preroll");
			else player.trigger("nopreroll");
		});

		player.on('readyforpostroll', function ()
		{
			if (options.postroll) prepareAds("postroll");
			else player.trigger("nopostroll");
		});

		player.trigger('adsready');

		function initTracker(ad, creative) {
			vastTracker = new DMVAST.tracker(ad, creative);
			vastTracker.load();

			techScreen.addEventListener('click', trackerClick);

			vastTracker.on('clickthrough', clickThrough);

			player.on('adtimeupdate', function () {
				vastTracker.setProgress(player.currentTime());
			});

			player.on('advolumechange', function () {
				vastTracker.setMuted(player.muted());
			});

			player.on('adpause', function () {
				vastTracker.setPaused(true);
			});

			player.on('adplay', function () {
				vastTracker.setPaused(false);
			});

			player.on('fullscreenchange', trackerFullscreenCheck);
		}

		function trackerClick() {
			vastTracker.click();
		}

		function clickThrough(url)
		{
			window.open(url);
		}

		function trackerFullscreenCheck()
		{
			vastTracker.setFullscreen(player.isFullscreen());
		}

		function prepareAds(type)
		{
			var waterfallIndex = 0;
			var podIndex = 0;

			var pod = options[type];
			if (type == "midroll") pod = pod.filter(group => group.time == closestMidroll);
			pod = pod.map(group => group.ads);
			
			player.ads.startLinearAdMode();
			playAd();

			function playAd() {
				player.one('adended', endOfGroup);
				player.one('aderror', nextAd);

				var currentAd = pod[podIndex][waterfallIndex];

				debugLog("Attempting", currentAd);

				DMVAST.parser.parse(currentAd, function (response, error)
				{
					if(error)
					{
						console.error(error);
						player.trigger("aderror");
					}
					else
					{
						var ads = response.ads;

						for(var a = 0; a < ads.length; a++)
						{
							for(var c = 0; c < ads[a].creatives.length; c++)
							{
								var creative = ads[a].creatives[c];

								var alternateFiles = false;

								switch (creative.type) {
									case 'linear':
										var adSource = [];
										for(var m = 0; m < creative.mediaFiles.length; m++)
										{
											var mediaFile = creative.mediaFiles[m];

											if(mediaFile.apiFramework)
											{
												if(mediaFile.apiFramework == "VPAID")
												{
													if(mediaFile.mimeType == "application/x-shockwave-flash")
													{
														debugLog("Playing", currentAd);
														loadFlashAdUnit(creative);
														alternateFiles = true;
														continue;
													}
													else if(mediaFile.mimeType == "video/mp4")
													{
														adSource.push({
															type: mediaFile.mimeType,
															src: mediaFile.fileURL
														});
														continue;
													}
													else if(mediaFile.mimeType == "application/javascript")
													{
														debugLog("Playing", currentAd);
														loadJSAdUnit(creative);
														alternateFiles = true;
														break;
													}
													else
													{
														console.warn(mediaFile.mimeType,"is not supported yet");
														console.log(mediaFile);
														continue;
													}
												}
												else
												{
													console.warn("No support for", mediaFile.apiFramework, "yet");
													console.log(mediaFile);
													continue;
												}
											}

											adSource.push({
												type: mediaFile.mimeType,
												src: mediaFile.fileURL
											});
										}
										
										if(!alternateFiles)
										{
											if (adSource.length > 0)
											{
												debugLog("Playing", currentAd);
												player.src(adSource);
												player.trigger('ads-ad-started');
												initTracker(ads[a], creative);
											}
											else
											{
												console.error("No possible sources for this creative", creative);
												player.trigger("aderror");
											}
										}

										break;
									case 'non-linear':
									case 'companion':
										break;
									default:
										console.warn("There's some type we don't know about:", creative.type);
										break;
								}
							}
						}
					}
				});
				
				function getPlayerDimensions()
				{
					var width = player.width();
					var height = player.height();
					
					if(player.isFullscreen())
					{
						width = window.innerWidth;
						height = window.innerHeight;
					}
					
					return {width: width, height: height};
				}
				
				function loadJSAdUnit(creative)
				{
					var vpaid = new VPAIDHTML5Client(vpaidContainer, techScreen, {});
					
					var mediaFile = creative.mediaFiles[0];
					
					player.pause();
					
					vpaid.loadAdUnit(mediaFile.fileURL, onLoad);

					function onLoad(err, adUnit)
					{
						if(err)
						{
							console.error(err);
							player.trigger("aderror");
							return;
						}

						adUnit.subscribe('AdLoaded', onInit);
						adUnit.subscribe('AdStarted', onStart);
						adUnit.subscribe('AdStopped', wrapUp);

						adUnit.handshakeVersion('2.0', onHandShake);
						
						function onHandShake(error, result)
						{
							var initialDimensions = getPlayerDimensions();
							
							adUnit.initAd(initialDimensions.width, initialDimensions.height, 'normal', -1, {AdParameters: creative.adParameters}, {});
						}

						function onInit()
						{
							adUnit.startAd();
						}

						function onStart()
						{
							player.trigger('ads-ad-started');
							player.controlBar.hide();
							player.on("resize",resizeAd);
							player.on("adplay",playAd);
							player.on("adpause",pauseAd);
							
							window.addEventListener("resize",resizeAd);
						}
						
						function wrapUp()
						{
							vpaid.destroy();
							player.controlBar.show();
							player.off("resize",resizeAd);
							window.removeEventListener("resize",resizeAd);
							player.trigger("adended");
						}
						
						function resizeAd()
						{
							var newDimensions = getPlayerDimensions();
							
							adUnit.resizeAd(newDimensions.width, newDimensions.height, player.isFullscreen() ? "fullscreen" : "normal");
						}

					}
				}

				function loadFlashAdUnit(creative)
				{
					var flashVPaid = new VPAIDFLASHClient(vpaidContainer, flashWrapperLoaded,{data: options.flashWrapperPath});
					
					var mediaFile = creative.mediaFiles[0];
					
					player.pause();
					
					function flashWrapperLoaded(error, result)
					{
						if(error)
						{
							console.error(error);
							player.trigger("aderror");
							return;
						}
						
						flashVPaid.loadAdUnit(mediaFile.fileURL, runFlashAdUnit);
					}
					
					function runFlashAdUnit(error, adUnit)
					{
						if(error)
						{
							console.error(error);
							player.trigger("aderror");
							return;
						}
						
						adUnit.handshakeVersion('2.0', initAd);
						adUnit.on('AdLoaded', startAd);
						
						adUnit.on('AdStopped', function (err, result) {
							flashVPaid.destroy();
							player.controlBar.show();
							player.off("resize",resizeAd);
							window.removeEventListener("resize",resizeAd);
							player.trigger("adended");
						});
						
						adUnit.on('AdError', function (err, result) {
							console.error(err);
							player.trigger("aderror");
						});

						adUnit.on('AdStarted', function (err, result) {
							checkAdProperties();
						});
						
						function initAd(err, result) {
							var initialDimensions = getPlayerDimensions();
							
							adUnit.initAd(initialDimensions.width, initialDimensions.height, 'normal', mediaFile.bitRate, {AdParameters: creative.adParameters}, '', function (err) {
								player.trigger('ads-ad-started');
								player.controlBar.hide();
								player.on("resize",resizeAd);
								window.addEventListener("resize",resizeAd);
							});
						}

						function startAd(err, result) {
							adUnit.startAd();
						}

						function checkAdProperties() {
							adUnit.getAdIcons();
							adUnit.setAdVolume(player.volume());
						}
						
						function resizeAd()
						{
							var newDimensions = getPlayerDimensions();
							
							adUnit.resizeAd(newDimensions.width, newDimensions.height, player.isFullscreen() ? "fullscreen" : "normal");
						}
					}
				}
			}

			player.one('adplaying', function (e)
			{
				player.trigger('ads-pod-started');
			});

			function nextAd()
			{
				player.off('adended', endOfGroup);
				waterfallIndex++;
				if(waterfallIndex < pod[podIndex].length) playAd();
				else endOfGroup();
			}

			function endOfGroup()
			{
				player.off('adended', endOfGroup);
				player.off('aderror', nextAd);
				player.trigger('ads-ad-ended');
				//The pod has successfully played an ad. Let's move to the next one and reset the position
				podIndex++;
				waterfallIndex = 0;

				if(vastTracker)
				{
					vastTracker.complete();
					vastTracker.close();
				}
				techScreen.removeEventListener('click', trackerClick);
				player.off('fullscreenchange', trackerFullscreenCheck);

				if(podIndex == pod.length)
				{
					if(type == "midroll")
					{
						playedMidrolls[closestMidroll] = true;
					}
					player.trigger('ads-pod-ended');
					player.ads.endLinearAdMode();
				}
				else playAd();
			}
		}

		function debugLog()
		{
			if(options.debug) console.log(...arguments);
		}
	};

	registerPlugin('vastWaterfall', vastWaterfall);

	return vastWaterfall;
})(window.videojs)