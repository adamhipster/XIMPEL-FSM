// Youtube
// The Youtube object implements a media type for XIMPEL to use. This media type is one of the core media types that ship with
// XIMPEL by default. MediaTypes are a sort of plugins. Anyone can create their own media type. None of the media types
// (not even the core media types) have a special integration with XIMPEL. There are just a number of requirements that should
// be fulfilled to create a MediaType (See the documentation for more info). 
//
// Notes:
// - The Youtube object definition is added to the: ximpel.mediaTypeDefinitions namespace, but this is not required, it
//   could be stored in any variable.
// - The MediaType gets a new instance of ximpel.MediaType() as prototype. This gives the media type a number of predefined 
//   methods. For instance this implements a play(), pause() and stop() method which XIMPEL will call. These methods in turn
//   will call the mediaPlay(), mediaPause() and mediaStop() methods that we implement in this Youtube object.
// - Besides the implementation of some required methods of a media type, the media type must be registered. This is
//   done at the bottom using the ximpel.registerMediaType() function.
//
// ##################################################################################################
// ##################################################################################################
// ##################################################################################################

// TODO: 
// - Youtube API: As an extra security measure, you should also include the origin parameter to the URL, specifying the URL scheme (http:// or https://) and full domain of your host page as the parameter value
// - Make it such that not all youtube elements are attached (but invisble) to the DOM at all times (even when their not being played).
// - Proper error handling (for example throw an event when a loading error occurs which ximpel can listen to?)



// The constructor function which XIMPEL will use to create instances of our media type. Four arguments
// should be passed to the constructor function:
// - customElements - contains the child elements that were within the <youtube> tag in the playlist.
// - customAttributes - contains the attributes that were on the <youtube> tag in the playlist.
// - $parentElement - The element to which the youtube iframe will be appended (the ximpel player element).
// - player - A reference to the player object, so that the media type can use functions from the player.
ximpel.mediaTypeDefinitions.YouTube = function( customElements, customAttributes, $parentElement, player, model ){
	// The custom elements that were added inside the <youtube> tag in the playlist.
	this.customElements = customElements; // not used right now.
	console.log('%c YouTube Constructor', 'font-size: 40px; color:#dd0000');

	// The custom attributes that were added to the <youtube> tag in the playlist.
	this.customAttributes = customAttributes;

	// The XIMPEL player element to which this youtube video can attach itself (this is the element to which all media DOM nodes will be attached).
	this.$attachTo = $parentElement;

	// A reference to the XIMPEL player object. The media type can make use of functions on the player object.
	this.player = player;
	var sqModel = new ximpel.SequenceModel();
	this.model = model;

	// The youtube video id (can be found in the URL of a youtube video).
	this.videoId = customAttributes.id;

	// Set mute audio
	this.mute = customAttributes.mute;

	// The x coordinate of the video relative to the ximpel player element or 'center' to align center.
	// The value for x should include the units (for instance: 600px or 20%)
	this.x = customAttributes.x || 'center';

	// The y coordinate of the video relative to the ximpel player element or 'center' to align center.
	// The value for y should include the units (for instance: 600px or 20%)
	this.y = customAttributes.y || 'center';

	// The width of the youtube element. The value includes units (ie. 600px or 20%).
	this.width = customAttributes.width || this.$attachTo.width() +'px';

	// The height of the youtube element. The value includes units (ie. 600px or 50%)
	this.height = customAttributes.height || this.$attachTo.height() + 'px';

	// The point in the video from which youtube should start playing (if not specified in the playlist then it is set to 0.)
	// The statTime should be in seconds but can be a floating point number.
	this.startTime = customAttributes.startTime || 0;

	// This is will hold the the jquery selector of the wrapper element for all youtube's DOM nodes (such as the youtube iframe element) 
	this.$youtubeContainer = null;

	// The youtube player requires an element which will be replaced by youtube's iframe, ie. a placeholder element
	this.$youtubePlaceholder = null;

	// Youtube has assigned click handlers to its iframe which cause the video to pause. This is not what
	// we want in ximpel because we want a clear and consistent user interaction for all media types. So we
	// use a "click catcher" element that will be placed over the youtube's iframe which ignores all click handlers.
	this.$youtubeClickCatcher = null;

	// This will contain the youtube player object which can be used to start and pause the video
	this.youtubePlayer = null;

	// This will hold a jquery promise object that indicates if the this.youtubePlayer is ready to play.
	this.readyToPlayPromise = null;

	// The state indicates the state of the youtube media item (playing, paused, stopped)
	this.state = this.STATE_STOPPED;
}
ximpel.mediaTypeDefinitions.YouTube.prototype = new ximpel.MediaType();
ximpel.mediaTypeDefinitions.YouTube.prototype.CLASS_YOUTUBE_CONTAINER = 'youtubeContainer';
ximpel.mediaTypeDefinitions.YouTube.prototype.CLASS_YOUTUBE_CLICK_CATCHER = 'youtubeClickCatcher';
ximpel.mediaTypeDefinitions.YouTube.prototype.STATE_PLAYING = 'state_youtube_playing';
ximpel.mediaTypeDefinitions.YouTube.prototype.STATE_PAUSED = 'state_youtube_paused';
ximpel.mediaTypeDefinitions.YouTube.prototype.STATE_STOPPED = 'state_youtube_stopped';



// The mediaPlay() is one of the required methods for a media type. XIMPEL calls the play() method on the
// prototype which in turn calls this mediaPlay() method.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaPlay = function(){
	// Ignore this call if this media item is already playing or resume playback if its paused.
	if( this.state === this.STATE_PLAYING ){
		return;
	} else if( this.state === this.STATE_PAUSED ){
		this.resumePlayback();
		return;
	}

	// Indicate that the media item is in a playing state now.
	this.state = this.STATE_PLAYING;

	// Before we can create Youtube Player objects we need to load the Youtube API script. So we first check if the script
	// has already been loaded by another instance of this Youtube media type. If it has then we don't need to do it again. 
	// We can check if it has because a jquery promise will have been stored in: ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise 
	// If such an object exists then the script is either in the process of being loaded, or completed/failed to load.
	if( ! ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise ){
		// Start loading the youtube api script. This stores ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise which is a jquery
		// promise object that is resolved when the script has been loaded or is rejected when the script failed to load.
		var apiLoadDeferred = this.loadYoutubeApi();
	}

	// Create and initialize some HTML elements (they will be attached to the DOM, but not displayed yet)
	this.initYoutubeElements();

	// Two things need to be loaded in order to start playing a youtube video:
	// - The youtube API script (is already being loaded by now)
	// - The youtube player.
	// We create a combined jquery deferred which resolves if both of these items are loaded or fails if any of them fail.
	var playerLoadDeferred = new $.Deferred();
	var readyToPlayDeferred = $.when( apiLoadDeferred, playerLoadDeferred ); // this is the combined deferred.
	this.readyToPlayPromise = readyToPlayDeferred.promise();

	// Register a callback for when the combined deferred is resolved (ie. when both the API script and the Youtube player are loaded)
	readyToPlayDeferred.done( function(){
		// start playing the youtube player.
		this.playYoutube();

		this.addSubjectSwitchSurvivor();

		console.log('this.player', this.player);

	}.bind(this) );

	// Check the state of youtube API script (ie. if its loaded yet or not)
	if( ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise.state() === "resolved" ){
		// API script is loaded, so start loading the player.
		this.loadYoutubePlayer( playerLoadDeferred ); 
	} else if( ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise.state() === "pending" ){
		// API script loading is not yet finished so register a callback that is called when the API
		// is loaded which will will start loading the youtube player. 
		ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise.done( function(){
			this.loadYoutubePlayer( playerLoadDeferred ); 
		}.bind(this) );
	} else if( ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise.state() === "rejected" ){
		// The API script failed to load.
		ximpel.warn("YouTube.mediaPlay(): failed to play the youtube element the youtube API didn't load properly.");
		return;
	}
}

ximpel.mediaTypeDefinitions.YouTube.prototype.addSubjectSwitchSurvivor = function(){
	// Add media item subject switch survivor
	// The traverse function determines where to put event listeners for the media item that survives a subject switch
	var traverse = function(model, path, modelListLength){
		path.push(model);
		if(model instanceof ximpel.MediaModel){
			console.log(model.customAttributes.id, this.model.customAttributes, 'this.player', this.player.firstSubjectModel, 'path', path[0]);
			if(model.customAttributes.id === this.model.customAttributes.id 
				|| this.player.currentSubjectModel.subjectId === path[0].subjectId
			) {
				return; //otherwise we are going to duplicate a lot of things and get bugs.
			}
			for (var i = 0; i < model.overlays.length; i++) {
				var overlay = model.overlays[i];
				for (var j = 0; j < overlay.leadsToList.length; j++) {
					var leadsTo = overlay.leadsToList[j];
					if(this.customAttributes.stopAtSubjectId === leadsTo.subject && this.customAttributes.stopAtSubjectId !== path[0].subjectId){
						console.log('leadsTo.subject', leadsTo.subject);
						console.log('traverse model', model);
						insertModel(path.slice());
						return;
					}
				}
			}
			return;
		}
		for (var k = 0; k < modelListLength; k++) {
			// console.log('1st for-loop', model, k);
			// console.log(path);
			traverse(model.list[k], path.slice());
		}
	}.bind(this);

	var insertModel = function(path){
		var subjectId = path[0].subjectId;
		var sequenceOrParallelModel = this.player.subjectModels[key].sequenceModel || this.player.subjectModels[key].parallelModel;

		console.log('%c insertModel', 'color: #ff0000', path);

		var traverse = function(sequenceOrParallelModel, modelListLength){
			for (var i = 0; i < modelListLength; i++) {
				if(sequenceOrParallelModel instanceof ximpel.ParallelModel){
					console.log('addModel', modelListLength);
					console.log('%c' + path[0].subjectId, 'color: #dd5500', path);
					console.log(sequenceOrParallelModel);
					console.log(this.model, this.model.customAttributes.id);
					var sqModel = new ximpel.SequenceModel(); //wrapping them in a sequence player to make them more recognizable for debugging purposes
					sqModel.isGlobal = true; //need to know this in order to dynamically delete stuff, making them truly recognizable
					sqModel.add(this.model); //create SequenceModel			
					sequenceOrParallelModel.add(sqModel);				//insert in Parallel Model
					return;
				} else {
					traverse(sequenceOrParallelModel.list[i]);
				}
			}
			return;
		}.bind(this);

		var modelListLength = sequenceOrParallelModel.list.length;
		traverse(sequenceOrParallelModel, modelListLength);
	}.bind(this);

	//this is where the first calls start
	for (var key in this.player.subjectModels) {
		var model = this.player.subjectModels[key].sequenceModel || this.player.subjectModels[key].parallelModel;
		if(model){
			var modelListLength = model.list.length;
			var path = [this.player.subjectModels[key]];
			traverse(model, path, modelListLength);
		}
	}
}

// The resumePlayback() method resumes playback from a paused state.
ximpel.mediaTypeDefinitions.YouTube.prototype.resumePlayback = function(){
	// Indicate that the media item is in a playing state now.
	this.state = this.STATE_PLAYING;
	if( this.readyToPlayPromise && this.readyToPlayPromise.state() === "resolved" ){
		this.youtubePlayer.playVideo();
	}
}



// This method starts loading the youtube api. When it finishes it will resolve
// the jquery promise stored in: ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise
// The state of this promise can be checked at any time to find out the state of the
// loading of the youtube API script.
ximpel.mediaTypeDefinitions.YouTube.prototype.loadYoutubeApi = function(){
	if( ! ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise ){
		// Store a jquery promise object on the ximpel.mediaTypeDefinitions.YouTube object to track if the youtube 
		// api script is loaded or not. The ximpel.mediaTypeDefinitions.YouTube object is not instance specific
		// but available to all instances of youtube. We do this because the API only needs to be loaded once, then
		// all Youtube instances can use it.
		var apiLoadDeferred = new $.Deferred();
		ximpel.mediaTypeDefinitions.YouTube.apiLoadPromise = apiLoadDeferred.promise();

		// If there was any third party code that uses the youtube api then it may have 
		// registered the window.onYouTubeIframeAPIReady() function already. In that case we 
		// overwrite that function with our own, but we call the third party function from our own function.
		var thirdPartyOnYouTubeIframeAPIReadyHandler = window.onYouTubeIframeAPIReady;
		
		// Define the event handling function that is called by youtube's script when it is fully loaded.
		window.onYouTubeIframeAPIReady = function(){
			// When the script is fully loaded, then the apiLoadDeferred is resolved.
			// All youtube instances that have attached a .done() method on this deferred/promise will
			// now have their function called.
			apiLoadDeferred.resolve();

			// And if there was an onYouTubeIframeAPIReady() function registered by any third party code, 
			// then we will call that function just to not break webpages that use it.
			if( thirdPartyOnYouTubeIframeAPIReadyHandler ){
				thirdPartyOnYouTubeIframeAPIReadyHandler();
			}
		}.bind(this);

		// Start loading the youtube API
		this.requestYoutubeApiScript( apiLoadDeferred );
		return apiLoadDeferred;
	} 
}
// This will make a request for the youtube API script.
ximpel.mediaTypeDefinitions.YouTube.prototype.requestYoutubeApiScript = function( apiLoadDeferred ){
	// We do the actual ajax request for the youtube api script.
	var ajaxRequest = $.ajax({
	    type: "GET",
	    url: "https://www.youtube.com/iframe_api",
	    dataType: "script",
	    cache: true
	});

	// When the script has failed to load, then we reject the deferred that was passed to this function.
	ajaxRequest.fail( function( jqXHR, textStatus, errorThrown ){
		ximpel.warn("YouTube.loadYoutubeApi(): failed to load the youtube api script (" + textStatus + ", " + errorThrown + ")");
		apiLoadDeferred.reject();
	}.bind(this) );

	// Note: we do NOT resolve the deferred here because the loaded script first needs to run and initialize
	// the youtube player api. We will know when this is ready because the script will call the function
	// window.onYouTubeIframeAPIReady which we registered earlier in Youtube.loadYoutubeApi().

    return apiLoadDeferred.promise();
}



// This will load the youtube player. After the youtube player is ready the this.readyToPlayPromise will be resolved.
ximpel.mediaTypeDefinitions.YouTube.prototype.loadYoutubePlayer = function( deferred ){
	// The function to be called when the youtube player is ready to be used.
	var youtubePlayerReadyHandler = function(){
		deferred.resolve();
	}

	this.youtubePlayer = new YT.Player( this.$youtubePlaceholder[0], {
		videoId: this.videoId,
		height: this.height,
  		width: this.width,
	    events: {
	        'onError': this.youtubePlayerErrorHandler.bind(this, deferred ),
	        'onReady': youtubePlayerReadyHandler.bind(this),
	        'onStateChange': this.youtubePlayerStateChangeHandler.bind(this)
	    },
	    playerVars: {
	    	/*'enablejsapi': 1,*/
	    	'html5': 1, 		// use the html5 player?
				'autoplay': 0,		// auto play video on load?
     		'controls': 0, 		// show controls?
     		'rel' : 0, 			// show related videos at the end?
     		'showinfo': 0,		// show video information?
     		'disablekb': 1,		// disable keyboard shortcuts?
     		'wmode': 'opaque',
     		'modestbranding': 0,
     		'iv_load_policy': 3, // show annotations? (3=no, 1 =yes)
     		'start': this.startTime
		}
	});

	return deferred;
}



// This tells the youtube player to start playing. It also shows and positions the youtube element at the appropriate position.
ximpel.mediaTypeDefinitions.YouTube.prototype.playYoutube = function(){
	this.repositionYoutubeIframe();
	if (this.mute) {
		this.youtubePlayer.mute();
	}
	else {
		this.youtubePlayer.unMute();
	}

	this.youtubePlayer.playVideo();
	this.$youtubeContainer.show();
}



// Create the youtube elements that are used by this media type and set some attributes.
ximpel.mediaTypeDefinitions.YouTube.prototype.initYoutubeElements = function(){
	// Create the wrapper HTML element for the youtube's iframe element.
	this.$youtubeContainer = $('<div></div>');

	// The youtube player requires an element which will be replaced by youtube's iframe, ie. the a placeholder:
	this.$youtubePlaceholder = $('<div></div>');

	// Youtube has assigned click handlers to its iframe which cause the video to pause. This is not what
	// we want in ximpel because we want a clear and consistent user interaction for all media types. So we
	// use a "click catcher" element that will be placed over the youtube's iframe which ignores all click handlers.
	this.$youtubeClickCatcher = $('<div></div>');


	this.$youtubeContainer.addClass( this.CLASS_YOUTUBE_CONTAINER );
	this.$youtubeClickCatcher.addClass( this.CLASS_YOUTUBE_CLICK_CATCHER );

	// Combine the youtube container and youtube click catcher elements in one jquery object.
	var $containerAndClickCatcher = this.$youtubeContainer.add( this.$youtubeClickCatcher );

	// Then style both of them, append them to the DOM and hide them.
	$containerAndClickCatcher.css({
		'position': 'absolute',
		'width': '100%',
		'height': '100%',
		'top': '0px',
		'left': '0px',
		'z-index': 1,
	});

	// Hide the youtube container then append the clickcatcher and the placeholder element.
	this.$youtubeContainer.hide();
	this.$youtubeClickCatcher.appendTo( this.$youtubeContainer );
	this.$youtubeContainer.appendTo( this.$attachTo );

	// Append the youtube place holder element to the youtube container. 
	// (the placeholder will be replaced with youtube's iframe).
	this.$youtubePlaceholder.appendTo( this.$youtubeContainer );
}




ximpel.mediaTypeDefinitions.YouTube.prototype.repositionYoutubeIframe = function(){
	var $youtubeIframe = this.$youtubeContainer.find("iframe");
	$youtubeIframe.css({
		'position': 'absolute'
	});

	if( this.x === 'center' ){
		var x = Math.round( Math.abs( this.$attachTo.width() - $youtubeIframe.width() ) / 2 ) + 'px';
	} else{
		var x = this.x;
	}
	if( this.y === 'center' ){
		var y = Math.round( Math.abs( this.$attachTo.height() - $youtubeIframe.height() ) / 2 )  + 'px';
	} else{
		var y = this.y;
	}
	$youtubeIframe.css({
		'left': x,
		'top': y 
	});
}



// Define what should happen in case of different error messages.
ximpel.mediaTypeDefinitions.YouTube.prototype.youtubePlayerErrorHandler = function( deferred, error ){
	if( error.data == 2 ){
       ximpel.warn("YouTube.youtubePlayerErrorHandler(): invalid parameters received. Possibly the video id is invalid.");
    } else if( error.data == 5 ){
    	ximpel.warn("YouTube.youtubePlayerErrorHandler(): The requested content cannot be played in an HTML5 player or another error related to the HTML5 player has occurred.");
    } else if( error.data == 100 ){
    	ximpel.warn("YouTube.youtubePlayerErrorHandler(): The video requested was not found. This error occurs when a video has been removed (for any reason) or has been marked as private.");
	} else if( error.data == 101 || error.data == 150 ){
		ximpel.warn("YouTube.youtubePlayerErrorHandler(): The owner of the requested video does not allow it to be played in embedded players.");
	} else{
		ximpel.warn("YouTube.youtubePlayerErrorHandler(): An unknown error has occured while starting the youtube player.");
	}
	deferred.reject();
}



// This is called when the youtube player changes state.
ximpel.mediaTypeDefinitions.YouTube.prototype.youtubePlayerStateChangeHandler = function( event ){
	var state = event.data;

	switch( state ){
		case YT.PlayerState.ENDED: 
			// The youtube video has ended. By calling ended() all callback functions registered with 
			// .addEventHandler('end', func) will be called. ended() and addEventHandler() are both functions 
			// on the prototype of this media type.
			this.ended(); 
			break;
	}
}



// The pause method pauses the youtube video if the video is in a playing state, otherwise it does nothing.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaPause = function(){
	// Ignore this pause request if the video is not in a playing state.
	if( this.state !== this.STATE_PLAYING ){
		return;
	}
	this.state = this.STATE_PAUSED;

	if( this.youtubePlayer && this.youtubePlayer.pauseVideo ){
		this.youtubePlayer.pauseVideo();
	}
}



// The stop method stops the video entirely without being able to resume later on. After this method the video playback pointer
// has been reset to its start position and the youtube i frame element is detached from the DOM, so nothing is visible anymore.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaStop = function(){
	console.log('%cmedia stop', 'color: green');
	console.log(this);
	if( this.state === this.STATE_STOPPED ){
		return;
	}
	
	var csm = this.player.currentSubjectModel;
	
	if( csm.subjectId  !== this.customAttributes.stopAtSubjectId && this.customAttributes.stopAtSubjectId !== undefined) {
		console.log('remove', csm.subjectId, this.customAttributes.stopAtSubjectId);
		console.log('media model', this.model);
		console.log('this.player.currentSubjectModel', this.player.currentSubjectModel);
		// this.state = this.STATE_PLAYING;
		// this.onEnd(this.player.sequencePlayer.mediaPlayer.handlePlaybackEnd.bind(this));
		return;
	}
	else {
		//remove all the globals in the playlist that have to do anything with this
		this.removeSubjectSwitchSurvivor();
	}
	this.state = this.STATE_STOPPED;
	this.youtubePlayer.pauseVideo();
	this.youtubePlayer.destroy();
	this.$youtubeContainer.remove();
	this.$youtubeContainer = null;
	this.$youtubePlaceholder = null;
	this.$youtubeClickCatcher = null;
	this.youtubePlayer = null;
	this.readyToPlayPromise = null;
}

ximpel.mediaTypeDefinitions.YouTube.prototype.removeSubjectSwitchSurvivor = function(){
	// The traverse function determines where to put event listeners for the media item that survives a subject switch
	var traverse = function(model, path, modelListLength){
		path.push(model);
		if(model === undefined){
			return;
		}
		if(model.list === undefined){
			return;
		}
		if(model.isGlobal === true
			&& model.list[0].customAttributes.id === this.model.customAttributes.id //id of traversed playlist needs to match with what the player currently is looking to delete.
		){
			var parentModel = path[path.length-2];
			var index = parentModel.list.indexOf(model);
			if(index !== -1){
				parentModel.list.splice(index, 1); //remove the item
			}
			return;
		}
		for (var k = 0; k < modelListLength; k++) {
			traverse(model.list[k], path.slice());
		}
	}.bind(this);

	//this is where the first calls start
	for (var key in this.player.subjectModels) {
		var model = this.player.subjectModels[key].sequenceModel || this.player.subjectModels[key].parallelModel;
		if(model && model !== undefined){
			// console.log('remove MISSS', model, key);
			var modelListLength = model.list.length;
			var path = [this.player.subjectModels[key]];
			traverse(model, path, modelListLength);
		}
	}
	// console.log('removeSubjectSwitchSurvivor', this.player.playlistModel);
}


// Every media item can implement a getPlayTime() method. If the media type implements this method then 
// ximpel will use this method to determine how long the media item has been playing. If this method is 
// not implemented then ximpel itself will calculate how long a media item has been playing. Note that
// the media item can sometimes better determine the play time. For instance, if the network has problems
// causing the video to stop loading, then ximpel would not be able to detect this and use an incorrect 
// play time. A Youtube media item could still determine the correct play time by looking at the current 
// playback time of the youtube player object (something that the core of ximpel has no access to). This is exactly 
// what the getPlayTime method of this youtube media item does. It returns the play time in miliseconds.
ximpel.mediaTypeDefinitions.YouTube.prototype.getPlayTime = function(){
	if( ! this.youtubePlayer || !this.youtubePlayer.getCurrentTime ){
		return 0;
	}
	var currentPlaybackTimeInMs = this.youtubePlayer.getCurrentTime()*1000;
	var startTimeInMs = this.startTime * 1000;
	var playTimeInMs = currentPlaybackTimeInMs - startTimeInMs;
	return playTimeInMs;
}



// Returns whether the video is playing.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaIsPlaying = function(){
	return this.state === this.STATE_PLAYING;
}



// Returns whether the video is paused.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaIsPaused = function(){
	return this.state === this.STATE_PAUSED;
}



// Returns whether the video is stopped.
ximpel.mediaTypeDefinitions.YouTube.prototype.mediaIsStopped = function(){
	return this.state === this.STATE_STOPPED;
}



// Finally we register the media type to XIMPEL such that XIMPEL knows some information about the media type.
// Information for the parser (tagname, allowedAttributes, requiredAttributes, allowedElements and requiredElements)
// and information for the XIMPEL player (the constructor such that it can create instances of the media type)
var mediaTypeRegistrationObject = new ximpel.MediaTypeRegistration( 
	'youtube',  							// = the media type ID (and also the tagname used in the playlist)
	ximpel.mediaTypeDefinitions.YouTube,	// a pointer to the constructor function to create instances of the media type.
	{
		'allowedAttributes': ['mute', 'videoId', 'width', 'height', 'x', 'y', 'startTime', 'stopAtSubjectId'], // the attributes that are allowed on the <youtube> tag (excluding the attributes that are available for every media type like duration).
		'requiredAttributes': ['videoId'],	// the attributes that are required on the <youtube> tag.
		'allowedChildren': ['source'],		// the child elements that are allowed on the <youtube> tag.
		'requiredChildren': ['source'] 		// The child elements that are required on the <youtube> tag.
	}
);

ximpel.registerMediaType( mediaTypeRegistrationObject );