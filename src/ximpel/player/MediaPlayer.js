// MediaPlayer()
// The media player is the component that plays a MediaModel. When you define a media item in the playlist, for instance
// a <video> or an <audio> media item, then the parser will convert this to a MediaModel which contains all the information
// about that media item such as: the duration, the overlays to be shown, the custom attributes and elements that were added
// between the media tags (between <video> and </video>), the variable modifers, etc.
// The MediaPlayer is responsible for:
// - starting the media item (ie. doing mediaItem.play() )
// - Showing/hiding overlays at the appropriate times.
// - Showing/hiding questions at the apropriate times.
//
// ########################################################################################################################################################

// TODO:
// - in update media player we check if the mediaHasEnded and if so, we do not update the overlays anymore.
//   we should probably update them anyway, but not use the play time but the total play time. The same 
//   counts for questions.

ximpel.MediaPlayer = function( player, mediaModel ){
	// The MediaPlayer uses and is used by the Player() object and as such it has a reference to it and all of the Player()'s data.
	this.player = player;

	// The $playerElement is the main element used to add all the DOM elements to that are part of ximpel (overlays, media items, questions, etc)
	this.$playerElement = player.getPlayerElement();

	// Will store the mediaModel which contains the information to determine when to show what (ie. overlays/media items/questions. etc.)
	this.mediaModel = null;

	// Will store the mediaItem which is the actual media type object that is to be played (ie. a Video object or Audio object for example).
	this.mediaItem = null;

	// This will hold a pointer to the function that can determine how long a media item has been playing. This will be
	// the default method implemented in this MediaPlayer unless the media item provides its own getPlayTime method.
	this.getPlayTime = null;

	// This will store the overlay models ordered by their startTime. 
	this.overlaysSortedByStartTime = null;

	// An index pointing to the first overlay in the 'overlaysSortedByStartTime' array which still has to be started / played.
	// This is increased by one whenever an overlay is displayed, so that it points to the next overlay that is to be displayed.
	this.overlayIndexToStartNext = 0;

	// The overlays that are currently being played/displayed are stored in the playingOverlays array
	this.playingOverlays = [];

	// The timeout handler for controlling media player updates. We store this to be able to turn the timeout off again.
	this.mediaPlayerUpdateHandler = null;

	// A boolean variable to indicate whether the media player has finished playing the media model.
	this.mediaHasEnded = false;

	// PubSub is used to subscribe callback functions for specific events and to publish those events to the subscribers.
	this.pubSub = new ximpel.PubSub();

	// The state of the media player (ie. playing, paused, stopped)
	this.state = this.STATE_STOPPED;

	// is used when unpausing the media player. It indicates whether play() should be called on the media item. 
	// This should only be done if the media item was in a playing state before the media player was paused.
	this.playMediaItemWhenMediaPlayerResumes = false;

	// If the media type that is being played does not provide a getPlayTime() function then we need to track how long
	// a media item has been playing by ourselves. The reason we check if the mediaItem provides a getPlayTime() function
	// is because a media item may be able to more accurately keep track of its playtime. For example a youtube video
	// may have loading issues (even if it has been partly preloaded). In that case the youtube media item may provide more
	// accurate information on how long it really has been playing (by reading the video's current playback time)
	// The MediaPlyer uses the playTimestamp and pauseTimestamps to keep track of how much play/pause time is passing.
	this.playTimestamp = 0;
	this.pauseTimestamp = 0;

	// The total play time indicates the time that the media item has been playing in total. The getPlayTime() method returns
	// The time the playback time of the media item, but this is not the same as the total playtime when the media item is being repeated.
	this.totalPlayTime = 0;

	// The on end subscription function is registered as onEnd callback, we store it so that we can unregister this callback function when
	// the media player stops playing this media item. We do this because we re-use media item objects.
	this.mediaItemOnEndSubscriptionFunction = null;

	// This will hold the questionManager instance that takes care of managing questions.
	this.questionManager = null;

	// If a mediaModel has been specified, then by calling use() we initialize the mediaPlayer to make it use the media model.
	// If no mediaModel has been specified then use() must be called manually before the mediaPlayer can start playing.
	if( mediaModel ){
		this.use( mediaModel, true );
	}
};
ximpel.MediaPlayer.prototype.MEDIA_PLAYER_UPDATE_INTERVAL = 50; 
ximpel.MediaPlayer.prototype.EVENT_MEDIA_PLAYER_END = 'ended';
ximpel.MediaPlayer.prototype.EVENT_IFRAME_OPEN = 'iframe_open';
ximpel.MediaPlayer.prototype.EVENT_IFRAME_CLOSE = 'iframe_close';
ximpel.MediaPlayer.prototype.STATE_PLAYING = 'state_mp_playing';
ximpel.MediaPlayer.prototype.STATE_PAUSED = 'state_mp_paused';
ximpel.MediaPlayer.prototype.STATE_STOPPED = 'state_mp_stopped';



// The use() method can be called to start using the given mediaModel. This resets the entire MediaPlayer and will then
// use the new media model for playback.
ximpel.MediaPlayer.prototype.use = function( mediaModel, preventReset ){
	// Reset this mediaPlayer if the preventReset argument is set to false. The preventReset is used when you know
	// the MediaPlayer is already in its default state.
	if( !preventReset ){
		this.reset();
	}

	this.mediaModel = mediaModel;

	// Get the media item corresponding to this media model from the player. (note that in principal
	// we could also construct the media item right here, however we decided to construct them in advance so they
	// can be re-used)
	this.mediaItem = this.player.mediaItems[mediaModel.mediaId];

	// Register an event handler for when the mediaItem ends. Note that not all media types will end. For instance, an image will play 
	// indefinitely unless manually interrupted by this MediaPlayer when it exceeds its duration as specified in the playlist.
	this.mediaItemOnEndSubscriptionFunction = this.mediaItem.addEventHandler( 'ended', this.handlePlaybackEnd.bind(this) );

	// If the mediaItem provides a getPlayTime method, then we use that one. If it doesn't then we use the default media player method.
	if( this.mediaItem.getPlayTime ){
		this.getPlayTime = this.mediaItem.getPlayTime.bind(this.mediaItem);
	} else{ 
		this.getPlayTime = this.getPlayTimeDefault;
	}

	// Create a QuestionManager and take the list of question-lists from the new mediaModel.
	// We tell the question manager to use that question list.
	this.questionManager = new ximpel.QuestionManager( this.player, this.$playerElement, this.getPlayTime, mediaModel.questionLists );

	// Take the list of overlays from the new mediaModel and store them sorted by starttime.
	this.overlaysSortedByStartTime = this.getOverlaysSortedByStartTime( mediaModel.overlays );
}



// The reset function resets the media player into the start state from where it can start playing a media model again.
// After this method the media player has no visual elements displayed anymore.
ximpel.MediaPlayer.prototype.reset = function( clearRegisteredEventHandlers ){
	if( this.mediaItem ){
		this.mediaItem.removeEventHandler( 'ended', this.mediaItemOnEndSubscriptionFunction );
		this.mediaItem.stop();
	}
	if( this.questionManager ){
		this.questionManager.stop();
		this.questionManager = null;
	}

	// Stop updating the media player (ie. checking if overlays/questions need to be started or stopped, etc.
	this.turnOffMediaPlayerUpdates();
	this.destroyPlayingOverlays();
	this.playingOverlays = [];
	this.overlayIndexToStartNext = 0;
	this.resetPlayTime();
	this.resetTotalPlayTime();
	this.mediaHasEnded = false;
	this.state = this.STATE_STOPPED;
	this.playMediaItemWhenMediaPlayerResumes = false;
	this.mediaItemOnEndSubscriptionFunction = null;

	if( clearRegisteredEventHandlers ){
		// resets the pubsub of the media player so that all registered callbacks are unregistered.
		this.clearEventHandlers();
	}
}



// Start playing the media model.
ximpel.MediaPlayer.prototype.play = function( mediaModel ){
	// If a mediaModel argument is specified then that media model will be used from now on.
	if( mediaModel ){ 
		this.use( mediaModel );
	} 

	// If no media model has been set for the media player then there is nothing to play.
	if( !this.mediaModel ){
		ximpel.error("MediaPlayer.play(): cannot start playing because no media model has been specified.");
		return;
	}

	// Ignore this play() call if the media player is already in a playing state.
	if( this.isPlaying() ){
		ximpel.warn("MediaPlayer.play(): play() called while already playing. See ximpel.MediaPlayer.prototype.play. If this is parallel player related, consider adding && !this.mediaModel.parallelModelIsParent to the if-statement that triggers this error.");
		return this;
	} 
	else if( this.isPaused() ){
		this.resume();
		return;
	}

	// Indicate that the media player is in a playing state.
	this.state = this.STATE_PLAYING;

	// Start playing the mediaItem -- see MediaType.js
	this.mediaItem.play();

	// This does some stuff needed to keep track of the playTime of a media item.
	this.updatePlayTimeTracking( this.STATE_PLAYING );

	// The media player needs to check if updates are necessary regurally such as checking if overlays need to be displayed at specific
	// points in time during the media playback or if a media item has surpassed its duration.
	this.turnOnMediaPlayerUpdates();
	return this;
}



// Pause playing the media model.
ximpel.MediaPlayer.prototype.pause = function(){
	// Ignore this pause() call if the media player is already in a paused state.
	if( this.isPaused() ){
		ximpel.warn("MediaPlayer.pause(): pause() called while already paused.");
		return this;
	}

	// Indicate that the media player is in a paused state.
	this.state = this.STATE_PAUSED;

	if( this.mediaItem.isPlaying() ){
		// Store that the media item should be played when the media player resumes. (is not the case if the media item is already paused.)
		this.playMediaItemWhenMediaPlayerResumes = true; 

		// pause the media item.
		this.mediaItem.pause();
	} else{
		// Store that the media item should not be played when the media player resumes (because it was already not playing before it was paused)
		this.playMediaItemWhenMediaPlayerResumes = false;
	}

	// This does some stuff needed to keep track of the playTime of a media item.
	this.updatePlayTimeTracking( this.STATE_PAUSED );

	// Turn off the media player updates. The play time of media-items doesn't change while pausing so no need to check for updates.
	this.turnOffMediaPlayerUpdates();

	return this;
}



// The resume method resumes the media player. This does nothing if the media player is not in a paused state.
// It will resume the media player from the same state that it was in when it was paused.
ximpel.MediaPlayer.prototype.resume = function(){
	// Ignore this resume() call if the media player is not in a paused state.
	if( !this.isPaused() ){
		ximpel.warn("MediaPlayer.resume(): resume() called while not paused.");
		return this;
	}

	// The media item was playing when the media player was paused, so we resume playing the media item now that the media player is playing again.
	if( this.playMediaItemWhenMediaPlayerResumes === true ){
		this.mediaItem.play();
	}

	// Inicate the media player is in a playing state again.
	this.state = this.STATE_PLAYING;

	// This does some stuff needed to keep track of the playTime of a media item.
	this.updatePlayTimeTracking( this.STATE_PLAYING );

	// Media player updates are always on when in a playing state, so we turn them on again.
	this.turnOnMediaPlayerUpdates();

	return this;
}



// Stop playing the media model. After the function has finished, no visual elements are displayed anymore by the media player.
// This method does nothing if the media player is already in a stopped state.
ximpel.MediaPlayer.prototype.stop = function(){
	// Ignore this stop() call if the media player is already in a stopped state.
	if( this.isStopped() ){
		return this;
	}

	// This does some stuff needed to keep track of the playTime of a media item.
	this.updatePlayTimeTracking( this.STATE_STOPPED );

	// Reset the media player back into its original state.
	this.reset();

	return this;
}



// This method updates the media player by checking several things such as whether overlays need to be displayed or hidden
// or checking whether the media item has reached its duration as specified in the playlist. This method will be called 
// every this.MEDIA_PLAYER_UPDATE_INTERVAL miliseconds as long as media player updates are on. These can be turned of with
// the method turnOffMediaPlayerUpdates()
ximpel.MediaPlayer.prototype.updateMediaPlayer = function(){
	var currentPlayTime = this.getPlayTime();

	// We update the overlays (ie. check if overlays need to be started/stopped) only if the media item has not yet ended.
	// If the media has ended but is set to repeat, then the overlays should not be repeated as well: just the media item.
	if( !this.mediaHasEnded ){
		this.updateOverlays( currentPlayTime );
	}

	if( !this.mediaHasEnded ){
		this.questionManager.update( currentPlayTime );
	}
	// Note that checkMediaItemDuration must be done after updateOverlays, because in the case when a media item has surpassed its duration limit
	// a ended event will be triggered. Its only logical to not do updates after that event anymore. Otherwise weird side affects may occur.
	this.checkMediaItemDuration( currentPlayTime );
}



// This function checks whether overlays need to be displayed or hidden based on their start time and duration.
ximpel.MediaPlayer.prototype.updateOverlays = function( currentPlayTime ){
	// Check if there are any overlays which need to be hidden/stopped by iterating over all the currently playing overlays.
	for( var i=0; i<this.playingOverlays.length; i++ ){
		var overlayEndTime = this.playingOverlays[i].endTime;

		// Check if the current play time is ahead of the overlay's end time...
		if( currentPlayTime >= overlayEndTime && overlayEndTime !== 0 ){
			// The end time of the overlay wa reached so we destroy the overlay view.
			this.playingOverlays[i].view.destroy();

			// Remove the overlay from the array of playing overlays.
			this.playingOverlays.splice( i, 1 );

			i--; // Since we deleted an overlay i should be decreased by 1 to not disturb our for loop.
		}
	}

	// Check if an overlay needs to be displayed. 
	var nrOfOverlaysToCheck = this.overlaysSortedByStartTime.length;
	for( var i=this.overlayIndexToStartNext; i<nrOfOverlaysToCheck; i++ ){
		var overlayModel = this.overlaysSortedByStartTime[i];
		if( overlayModel.startTime > currentPlayTime || currentPlayTime === 0 ){
			// The overlay is not ready to be played yet. Since the overlays are sorted on startTime
			// we know that the rest of the overlays are not ready either so we break out of the for loop.
			break;
		} else{
			// Its time to show this overlay, so we create its view and attach a click handler to it.
			var overlayView = new ximpel.OverlayView( overlayModel );
			overlayView.render( this.$playerElement );
			overlayView.onOneClick( this.handleOverlayClick.bind(this, overlayModel, overlayView ) );

			// Add the view to an array containing the currently playing overlays.
			var overlayEndTime = overlayModel.duration > 0 ? overlayModel.startTime+overlayModel.duration : 0; // an end time of 0 means until the end of the media item.
			this.playingOverlays.push( {'view': overlayView, 'model': overlayModel, 'endTime': overlayEndTime} );
			// An overlay has now been displayed, so we make overlayIndexToStartNext point to the next overlay which is the one to be displayed next.
			this.overlayIndexToStartNext++;
		}
	}
} 



// This function defines what happens when an overlay is clicked. It is given an overlayModel and the overlayView of the 
// overlay that was clicked.
ximpel.MediaPlayer.prototype.handleOverlayClick = function( overlayModel, overlayView ){
	if( this.isPaused() ){
		// The click handler of our overlay views disappear after being clicked once
		// because we don't want the user to be able to spam-click the overlay. 
		// Because this overlay click happened while the media player was paused,
		// we ignore the click and just re-attach the click handler.
		overlayView.onOneClick( this.handleOverlayClick.bind(this, overlayModel, overlayView ) );
		ximpel.warn("MediaPlayer.handleOverlayClick(): Cannot use overlays when in a paused state!");
		return;
	}

	// Apply all variable modifiers that are defined for the overlay that was clicked.
	this.player.applyVariableModifiers( overlayModel.variableModifiers );

	// Determine the leadsTo value for the overlay that was clicked.
	var leadsTo = this.player.determineLeadsTo( overlayModel.leadsToList );

	if( leadsTo ){
		// Check if URL is set to be displayed in iframe
		var urlAttr = 'url:';
		if (leadsTo.toLowerCase().indexOf(urlAttr) === 0){
			// Re-attach overlay click handler if playing; otherwise it already has been attached
			if( this.isPlaying() ){
				this.player.pause();
				overlayView.onOneClick( this.handleOverlayClick.bind(this, overlayModel, overlayView ) );
			}

			// Generate iframe with close button and inject into DOM
			var url = leadsTo.substr(urlAttr.length);
			$player = this.player;
			$urlDisplay = $('<div class="urlDisplay"></div>');

			$closeButton = $('<img class="closeButton" src="ximpel/images/close_button.png"/>')
				.one('click', function(){
					this.pubSub.publish( this.EVENT_IFRAME_CLOSE, url );
					$urlDisplay.remove();
					if( $player.isPaused() ){
						$player.resume();
					}
				}.bind(this));

			$urlDisplay.append( $('<iframe src="' + url + '"></iframe>') )
				.append( $closeButton )
				.appendTo( this.player.getPlayerElement() );

			this.pubSub.publish( this.EVENT_IFRAME_OPEN, url );

		} else{
			// start playing the subject specified in the leadsTo
			this.player.goTo( leadsTo );
		}
	}
}



// This method checks whether the media item has reached its duration limit (as specified in the playlist)
// A duration of "0" means it will be played indefinitely.
ximpel.MediaPlayer.prototype.checkMediaItemDuration = function( currentPlayTime ){
	var allowedPlayTime = this.mediaModel.duration || 0;

	if( currentPlayTime >= allowedPlayTime && allowedPlayTime !== 0 ){
		this.handleDurationEnd();
	}
}



// This function is called when a media item has come to an end either because the specified duration has been exceeded or
// because there is nothing more to play (the video reached the end for example).
ximpel.MediaPlayer.prototype.handleMediaEnd = function(){
	this.mediaHasEnded = true;

	// If the media item should be repeated (indicated by mediaModel.repeat) then we just replay the media item and do nothing.
	// The user must click an overlay (or any other interaction) to proceed. The media item will replay indefinitely.
	// Note this only repeats the media item itself and not all the overlays/questions/etc. that are defined to play during
	// this media item.
	if( this.mediaModel.repeat ){
		this.replayMediaItem();
		return;
	}

	this.turnOffMediaPlayerUpdates();
	this.mediaItem.pause();

	// If the media model that is being played by this mediaPlayer has specified a subject in its leadsTo attribute then we we tell
	// the player to play that subject. The player will start playing a new subject immediately, so we should not do anything after that anymore.
	var leadsTo = this.player.determineLeadsTo( this.mediaModel.leadsToList );
	if( leadsTo ){
		this.player.goTo( leadsTo );
	} else{
		// if no subject was specified to play next by the mediaModel, then the media player will throw its end event.
		// The component that listens for that event will be in control from then on (ie. the sequence player or maybe 
		// a parallel player)
		console.log('EVENT_MEDIA_PLAYER_END -- this.mediaModel')
		console.log(this.mediaModel)
		this.pubSub.publish( this.EVENT_MEDIA_PLAYER_END );
	}
}



// This function is the handler function for when the media item has ended. This will only ever be called if the media item has an 
// ending (such as a video). Media items like images can play indefinitely and because of that they will never throw an end event.
// Note that this handler function is not called when the media item exceeds its duration.
ximpel.MediaPlayer.prototype.handlePlaybackEnd = function(){
	// In this function we can specify any task that needs to be executed when the media has come to its playback end and thus
	// has nothing more to play.
	this.handleMediaEnd();
} 



// This function is the handler function for when the media item's playing duration has been exceeded. This will not be called when the
// media item has come to its playback end.
ximpel.MediaPlayer.prototype.handleDurationEnd = function(){
	// In this function we can specify any task that needs to be executed when the media has been playing longer than its maximum duration.
	this.handleMediaEnd();
}



// This method replays a media item (only the media item not the overlays or anything else).
ximpel.MediaPlayer.prototype.replayMediaItem = function(){
	this.totalPlayTime += this.getPlayTime();
	this.mediaItem.stop();
	this.mediaItem.play();
}



// Returns the total playtime of the mediaModel
ximpel.MediaPlayer.prototype.getTotalPlayTime = function(){
	return this.totalPlayTime + this.getPlayTime();
}



// This method is used to keep track of how long a media item has been playing. Whenever the media item changes from or to
// a pause, play or stop state this method is called to update a play timestamp and a pause timestamp which together can indicate
// how long the media item has been playing.  Playtime tracking works as follows:
// As long as the media player is playing, the pauseTimestamp will be 0 and the playTimestamp will be a timestamp
// such that: Date.now() - playTimestamp = <playTimeOfMediaItem>. However if we go into a pause state, the playTimestamp
// will not be accurate anymore because for some of the time between Date.now() - playTimestamp we were not playing but pausing.
// So whenever we move to a playing state we add the paused time to the playTimestamp so that the paused time does not add up to 
// the play time. Changing to a stop state causes both timestamps to reset.
ximpel.MediaPlayer.prototype.updatePlayTimeTracking = function( stateChange ){
	if( stateChange === this.STATE_PLAYING ){
		// Calculate the time between Date.now() and the timestamp at which the media player was paused. This is the pause time.
		var pauseTime = (this.pauseTimestamp === 0) ? 0 : (Date.now()-this.pauseTimestamp);

		// If no playTimestamp is set then we initialize it to the current time. If the playTimestamp was already initialized then 
		// we add the pauseTime to it so that the time that the media player was paused doesnt add up the play time of the media item.
		// that the play timestamp refers to the time the media was actually playing.
		this.playTimestamp = this.playTimestamp === 0 ?	Date.now() : (this.playTimestamp+pauseTime);

		// Reset the pause timestamp because we already added this paused time to the playtimestamp.
		this.pauseTimestamp = 0;
	} else if( stateChange === this.STATE_PAUSED ){
		// Set the pause timestamp to Date.now() but only if a timestamp was not already set. If a timestamp was already set then we were already in a paused 
		// state. We know that because the pause timestamp is reset whenever we go from a paused state to a non-paused state, ie. play or stop state).
		this.pauseTimestamp = this.pauseTimestamp === 0 ? Date.now() : this.pauseTimestamp;
	} else if( stateChange === this.STATE_STOPPED ){
		// When we move to a stop state, both timestamps are reset because all media player state is lost when doing a stop().
		this.playTimestamp = 0 ;
		this.pauseTimestamp = 0 ;
	}
}



// getPlayTimeDefault() is the default way for the mediaPlayer to determine how long the media item has been playing (in miliseconds). It is based
// on how long the media item has been in a playing state. However, this may not be accurate if there are streaming issues for example. So this method
// is only used if the media item does not provide its own getPlayTime() method. The media item may be able to provide a more accurate getPlayTime value
// because it can look at the playback time of the video for example (in the case of a Video media item)
ximpel.MediaPlayer.prototype.getPlayTimeDefault = function(){
	// We first determine the pause time which is 0 if we are not in the paused state because whenever we move from a paused state to a non-paused state
	// we substract the paused time from the play time and set the pause time to 0. If we are in the paused state then the pause time is the difference 
	// between Date.now() and the pauseTimestamp.
	var currentTimestamp = Date.now();
	var pauseTime = this.pauseTimestamp === 0 ? 0 : (currentTimestamp-this.pauseTimestamp);

	// Return the time that the media item has actually been playing. 
	var playTime = currentTimestamp - this.playTimestamp + pauseTime;
	return playTime;
}



// Turn on media player updates (ie. checking for changes in overlays, questions, etc.).
ximpel.MediaPlayer.prototype.turnOnMediaPlayerUpdates = function(){
	this.mediaPlayerUpdateHandler = setTimeout( function(){
		this.turnOnMediaPlayerUpdates();
		this.updateMediaPlayer();
	}.bind(this), this.MEDIA_PLAYER_UPDATE_INTERVAL );
}



// Turn off media player updates (ie. checking for changes in overlays, questions, etc.).
ximpel.MediaPlayer.prototype.turnOffMediaPlayerUpdates = function(){
	if( this.mediaPlayerUpdateHandler ){
		clearTimeout( this.mediaPlayerUpdateHandler );
	}
	this.mediaPlayerUpdateHandler = null;
}



// Destroy all overlay views.
ximpel.MediaPlayer.prototype.destroyPlayingOverlays = function(){
	this.playingOverlays.forEach( function( playingOverlay ){
		playingOverlay.view.destroy();
	}.bind(this) );
}



// Return a new array containing the overlayModels from the given array sorted by startTime.
ximpel.MediaPlayer.prototype.getOverlaysSortedByStartTime = function( overlays ){
	// overlays.slice() creates a copy of the overlays array and then sort() sorts them by start time.
	var overlaysSorted = overlays.slice().sort( function( overlay1, overlay2 ){
		if (overlay1.startTime === overlay2.startTime) {
			// Some browser implementations of Array.sort are non-stable, so
			// compare the indexes to retain the current order (stable sort)
			return overlay1.index - overlay2.index;
		}
		return overlay1.startTime - overlay2.startTime;
	} );
	
	// Return the copy of the overlays array
	return overlaysSorted;
}



ximpel.MediaPlayer.prototype.addEventHandler = function( event, callback ){
	this.pubSub.subscribe( event, callback );
	return this;
}



ximpel.MediaPlayer.prototype.clearEventHandlers = function( callback ){
	this.pubSub.reset();
	return this;
}



ximpel.MediaPlayer.prototype.isPlaying = function(){
	return this.state === this.STATE_PLAYING;
}



ximpel.MediaPlayer.prototype.isPaused = function(){
	return this.state === this.STATE_PAUSED;
}



ximpel.MediaPlayer.prototype.isStopped = function(){
	return this.state === this.STATE_STOPPED;
}



ximpel.MediaPlayer.prototype.resetPlayTime = function(){
	this.pauseTimestamp = 0;
	this.playTimestamp = 0;
}



ximpel.MediaPlayer.prototype.resetTotalPlayTime = function(){
	this.totalPlayTime = 0;
}