// Player()
// The ximpel.Player object is the object that manages the actual playing of the presentation. 
// The Player() constructor function takes three arguments "playerElement", "playlistModel" and "configModel"
// Based on a PlaylistModel and a ConfigModel object it plays a presentation and displays it in the playerElement.
//
// Public methods:
// play()
// pause()
// stop()
// goTo( <subjectId> )
// getVariable( variableId )
// isPlaying()
// isPaused()
// isStopped()
// getConfigProperty()
// addEventHandler()
// clearEventHandler
// clearEventHandlers()
//
// ########################################################################################################################################################

// TODO:
// - when the player has nothing more to play it just simply stops leaving the player in state "playing".
//   would be better to show an end screen orso. and the buttons should be updated (for example the playbutton should
//   change to a replay button.


ximpel.Player = function( playerElement, playlistModel, configModel ){
	// The player element is the html elment to which all DOM elements will be attached (ie. the media types/overlays/etc.)
	this.$playerElement = ximpel.wrapInJquery( playerElement );

	// The "playlistModel" contains the data that the Player requires to play the presentation.
	// This is a PlaylistModel() object constructed by the parser based on the playlist file.
	this.playlistModel = playlistModel;

	// The "configModel" contains all the data related to configuration settings for the player.
	// This is a ConfigModel() object constructed by the parser based on the config file.
	this.configModel = configModel;

	// Stores the subject models. A subject model can be retrieved like so: this.subjectModels[subjectId].
	this.subjectModels = playlistModel.subjectModels;

	// Stores the ID of the subject that is to be started when the player starts.
	this.firstSubjectModel = this.getFirstSubjectModel();

	// The available media types is an object containing all the mediaTypeRegistration objects. These registrations contain data about the implemented 
	// media types. A mediaTypeRegistration object can be retrieved like: this.availableMediaTypes[<mediaTypeName>]. For instance: availableMediaTypes['video']
	// For the Player the most important data in the registration object is a pointer to the constructor of the media type. A new instance of a media type
	// can be created like this: var videoInstance = new availableMediaTypes['video'].mediaTypeConstructor();
	this.availableMediaTypes = ximpel.availableMediaTypes; 

	// The mediaItems object will contain all the media type instances (ie. it will contain all the Video() objects, Audio() objects, etc.)
	// A media item is refered to by its mediaId, where the mediaId is a property in the mediaModel that is filled by the parser (ie. each 
	// <video>, <audio>, etc. gets a unique ID). Referring to a media item is done like this: this.mediaItems[<mediaId>]  The result is a media
	// instance (for example a Video() object or an Audio() object) on which methods like play(), pause() and stop() can be called.
	// The media instances will be created and added to the mediaItems object by the constructMediaItems() function.
	this.mediaItems = {};

	// Will hold the subjectModel that is currently being played.
	this.currentSubjectModel = null;

	// The pubSub object is used internally by the player for registering event handlers and publishing events to the registered handlers.
	this.pubSub = new ximpel.PubSub();

	// The ximpel player can keep track of variables. Variables can be declared and modified using the <score> or <variable> tag in the playlist.
	this.variables = [];

	// The state of the player (ie. paused/playing/stopped)
	this.state = this.STATE_STOPPED;

	// Each subject contains exactly one main sequenceModel that is to be played. The sequencePlayer plays such a sequeceModel.
	// Note that a sequenceModel itself may contain: media items, other sequence models and parralel models. However, since
	// the ximpel Player always has one main sequence, it can just tell the sequence player to play/pause/stop that main
	// sequence without worrying about how complex that sequence may be.
	this.sequencePlayer = new ximpel.SequencePlayer( this );

	// Add an event handler function for when the sequence player finished playing a sequence. When a sequence has ended
	// because all the items in the sequence have finished playing, the sequence player will trigger this event.
	this.sequencePlayer.addEventHandler( this.sequencePlayer.EVENT_SEQUENCE_END, this.handleSequencePlayerEnd.bind(this) );

	//Initialize analytics library and register event handlers for analytics library
	this.analytics = new ximpel.Analytics();
	this.analytics.initialize();

	if (typeof Hammer === 'undefined') {
		ximpel.warn('Hammer is not loaded. Swipe events will not be supported.');
	} else {
		// Add Hammer to handle swipes
		this.mc = new Hammer.Manager( this.$playerElement[0] );

		this.mc.add( new Hammer.Pan() );
		this.mc.on( 'pan', this.onPan.bind(this) );
	}

	// Do some stuff to initialize the player to make it ready for use.
	this.init();
};
ximpel.Player.prototype.STATE_PLAYING = 'state_player_playing';
ximpel.Player.prototype.STATE_PAUSED = 'state_player_paused';
ximpel.Player.prototype.STATE_STOPPED = 'state_player_stopped';
ximpel.Player.prototype.EVENT_PLAYER_END = 'ended';
ximpel.Player.prototype.EVENT_VARIABLE_UPDATED = 'variable_updated';
ximpel.Player.prototype.EVENT_SWIPE = 'swipe';

// Sent when a subject begins to play. The subject model is included as an argument.
ximpel.Player.prototype.EVENT_SUBJECT_PLAYING = 'subject_playing';


// init() initializes the player once when the Player is constructed, but is never called again after that.
ximpel.Player.prototype.init = function(){
	// Create an instance (mediaItem) for each mediaModel (ie. for each media tag present in the the playlist.
	// This fills the this.mediaItems object with media items. A mediaItem can then be returned by doing:
	// this.mediaItem[ mediaModel.mediaId ]
	this.constructMediaItems();

	// This applies all variable modifiers on the playlist model which will initialize the
	// variables with a value. They are stored in: this.variables
	this.applyVariableModifiers( this.playlistModel.variableModifiers );

	return this;
}



// Reset the player to bring it back into a state where it was in when the Player() was just constructed
// and initialized. After this method the player is in a stopped state and the play() method can be called 
// as if it was the first time the player was being played.
ximpel.Player.prototype.reset = function( clearRegisteredEventHandlers ){
	this.state = this.STATE_STOPPED;
	this.currentSubjectModel = null;
	
	// Stop the sequence player. This resets the sequence player to its initial state.
	this.sequencePlayer.stop();
	

	// Re-initialize variables.
	this.variables = [];
	this.applyVariableModifiers( this.playlistModel.variableModifiers );

	// If specified then the event handlers registered on the Player()'s pubSub will be reset.
	if( clearRegisteredEventHandlers ){
		this.clearEventHandlers(); 		
	}
}



// Start playback of the player. If the player was paused it will resume instead.
ximpel.Player.prototype.play = function(){
	if( this.isPlaying() ){
		ximpel.warn("Player.play(): play() called while already playing.");
		return this;
	} else if( this.isPaused() ){
		this.resume();
		return this;
	}

	// indicate the player is in a playing state.
	this.state = this.STATE_PLAYING;

	// This play() method is called from a stopped state so start playing the first subject.
	this.playSubject( this.firstSubjectModel );
	return this;
}



// Start playing a given subjectModel.
ximpel.Player.prototype.playSubject = function( subjectModel ){
	// Set the specified subjectModel as the current subject model
	this.currentSubjectModel = subjectModel;

	// Each subject contains exactly one sequence model. The sequencePlayer plays such a sequence model. The sequence model itself may contain
	// one or more media models and parrallel models which in turn may contain sequence models again. This playback complexity is all handled by
	// the sequence player so we do not need to worry about that here, we just need to tell the sequence player to start playing the sequence
	// of our subject.
	var sequenceModel = undefined;
	if(subjectModel.sequenceModel){
		sequenceModel = subjectModel.sequenceModel;
	}
	else if(subjectModel.parallelModel){
		// If subjectModel, then pretend the parallelModel has a SequenceModel as parent.
		// We need to keep the illusion that the ximpel player has only one SequenceModel.
		sequenceModel = new ximpel.SequenceModel();
		sequenceModel.add(subjectModel.parallelModel);
	}

	// In the playlist you can define variables/scores to be changed when a subject starts. When you do this
	// the parser will add a variableModifier object and store it in a list of variableModifiers for that subject.
	// When the subject is requested to be played we need to apply these variable modifiers to the variables, This
	// is what we do next.
	this.applyVariableModifiers( subjectModel.variableModifiers );

	// Then finally tell the sequence player to start playing the sequence model of our subject.
	this.sequencePlayer.play( sequenceModel );

	// Save it to the analytics
	this.analytics.addSubject( subjectModel );
	// Publish the subject play event. Any (third party) code that registered a handler for this event using
	// addEventHandler() will have its handler called.
	this.pubSub.publish( this.EVENT_SUBJECT_PLAYING, subjectModel );
}



// Resume playback of the player.
ximpel.Player.prototype.resume = function(){
	// Ignore this resume() call if the player is already in a playing state.
	if( !this.isPaused() ){
		ximpel.warn("Player.resume(): resume() called while not in a paused state.");
		return this;
	}
	// Indicate the player is now in a playing state again.
	this.state = this.STATE_PLAYING;

	// Resume the sequence player.
	this.sequencePlayer.resume();

	return this;
}



// Pause playback of the player.
ximpel.Player.prototype.pause = function(){
	// Ignore this pause() call if the player is not in a playing state.
	if( ! this.isPlaying() ){
		ximpel.warn("Player.pause(): pause() called while not in a playing state.");
		return this;
	}

	// Indicate the player is now in a paused state.
	this.state = this.STATE_PAUSED;

	// Pause the sequence player.
	this.sequencePlayer.pause();

	return this;
}



// Stop playback of the player.
ximpel.Player.prototype.stop = function(){
	// Ignore this stop() call if the player is already in the stopped state.
	if( this.isStopped() ){
		ximpel.warn("Player.stop(): stop() called while already in a stopped state.");
		return this;
	}

	// Indicate the player is now in a stopped state.
	this.state = this.STATE_STOPPED;

	// Resets the player to the point it was in right after its construction and after the init() method.
	// After the reset its ready to be play()'ed again.
	this.reset();

	return this;
}



// Jump to the subject with the given subjectId. This method can be called at anytime from anywhere and
// will cause the player to stop playing what it is playing and jump to the specified subject.
ximpel.Player.prototype.goTo = function( subjectId ){
	var subjectModel = this.subjectModels[subjectId];

	if( !subjectModel ){
		ximpel.warn("Player.goTo(): Cannot play a subject with subjectId '" + subjectId + "'. There is no subject with that id.");
		return;
	}

	this.playSubject( subjectModel );
	return this;
}



// Retrieve a variable with a given id or the default variable if no id is given.
ximpel.Player.prototype.getVariable = function( variableId ){
	return this.variables[variableId];
}



// This method takes an array of variable modifiers and applies each of them. After this method each of the modifiers have been applied.
// See function: applyVariableModifier() for more info on what a variable modifier is.
ximpel.Player.prototype.applyVariableModifiers = function( variableModifiers ){
	$.each( variableModifiers, function( index, value ){
  		var variableModifier = variableModifiers[index];
  		this.applyVariableModifier( variableModifier );
	}.bind(this) );
}



// This function applies one variableModifier. A variable modifier contains:
// - A variable id which indicates the variable to modify
// - An operation that changes the value of the variable
// - The value used by the operation
// For example when: id="score1", operation="add", value="6", the variable modifier adds 6 to the "score1" variable.
ximpel.Player.prototype.applyVariableModifier = function( variableModifier ){
	var currentVariableValue = this.variables[ variableModifier.id ];

	// If the variable to which the modification is applied hasn't been defined yet, then we define it right here to 0.
	if( currentVariableValue === undefined ){
		this.variables[ variableModifier.id ] = 0;
		currentVariableValue = 0;
	}

	// Apply the operation.
	switch( variableModifier.operation ){
		case variableModifier.OPERATION_SET:
			var newValue = variableModifier.value;
			break;
		case variableModifier.OPERATION_ADD:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue += Number( variableModifier.value );
			newValue = parseInt(newValue);
			break;
		case  variableModifier.OPERATION_SUBSTRACT:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue -= Number( variableModifier.value );
			newValue = parseInt(newValue);
			break;
		case variableModifier.OPERATION_MULTIPLY:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue *= Number( variableModifier.value );
			newValue = parseInt(newValue);
			break;
		case variableModifier.OPERATION_DIVIDE:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue /= Number( variableModifier.value );
			newValue = parseInt(newValue);
			break;
		case variableModifier.OPERATION_POWER:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue = Number( Math.pow(newValue, variableModifier.value ) );
			newValue = parseInt(newValue);
			break;
		default:
			var newValue = currentVariableValue;
	}

	// Store the new value of the variable
	this.variables[ variableModifier.id ] = newValue;

	// Publish event
	this.pubSub.publish( this.EVENT_VARIABLE_UPDATED, variableModifier.id );
}



// Return whether the player is playing.
ximpel.Player.prototype.isPlaying = function(){
	return this.state === this.STATE_PLAYING;
}



// Return whether the player is paused.
ximpel.Player.prototype.isPaused = function(){
	return this.state === this.STATE_PAUSED;
}



// Return whether the player is stopped.
ximpel.Player.prototype.isStopped = function(){
	return this.state === this.STATE_STOPPED;
}



// When in the playlist you specify a leadsTo attribute and/or <leadsTo> elements in a subject, overlay or media item then the parser
// will construct a list of leadsToModels and stores it in that subjectModel, overlayModel or mediaModel. Whenever that subject
// finishes, the overlay is clicked or the media item finishes, XIMPEL will look at that list of leadsToModels and based on that
// list it determines which leadsTo value to use next (ie. which subject to play next).
// A LeadsToModel consists of:
// - a subject attribute specifying the subject to play.
// - a condition attribute specifying the condition under which this leadsTo attribute should be used. When
//   no condition is specified its the default leadsTo value that will be used if no other leadsTo model's condition is met.
// The determineLeadsTo() method is the method that determines which of the leadsTo models should be used.
// Note that both the leadsTo attribute and <leadsTo> elements are converted to leadsTo models by the parser so they
// are basically the same, except when using the leadsTo attribute you cannot specify a condition. So this is
// usually the default leadsTo value.
// Return value: the subjectId that should be played next or null if there is no subject to play next.
ximpel.Player.prototype.determineLeadsTo = function( leadsToModels ){
	var defaultLeadsTo = null;

	// Loop over all leadsToModels in the given array and find out which leadsTo value should be used (if any)
	for( var i=0; i<leadsToModels.length; i++ ){
		var leadsToModel = leadsToModels[i];

		// If the current leadsToModel has no condition specified, then its the default leadsToModel.
		// The default is only used when all of the conditional leadsToModels evaluate to false. In other
		// words: the condition leadsToModels have precedence over the default leadsToModel.
		// We store the default leadsTo subject-id and continue evaluating the other leadsToModels.
		if( !leadsToModel.conditionModel ){
			defaultLeadsTo = leadsToModel.subject;
			continue;
		}

		// The leadsToModel has a condition so we evaluate it and if the condition is true,
		// then we return this leadsToModel as the result.
		var conditionIsTrue = this.evaluateCondition( leadsToModel.conditionModel );
		if( conditionIsTrue ){
			return leadsToModel.subject;
		}
	}

	// returns a subject id.
	return defaultLeadsTo;
}



// This method evaluates a conditionModel. The condition model specifies the condition/expression that
// is to be evaluated. By using a conditionModel object as a wrapper around the actual condition/expression 
// we allow future changes in how the condition is represented. Right now the conditionModel just takes
// a string wich might contain templated variable names in the form: {{variableName}}
// The templated variable names should correspond with a variable declared in the playlist. If no such
// variable exists then it is not replaced. After the variable values have replaced the templated variable
// names, the eval method is used to execute the expression and the result (true or false) is returned.
ximpel.Player.prototype.evaluateCondition = function( conditionModel ){
	var condition = conditionModel.condition;
 	var parsedCondition = condition;

	// First we retrieve an array of all the templated variable names. Templated variables look like this {{variableName1}}
	// So for the string: "{{x}}+{{x}}=={{y}}" we get an array: ['x','x','y']
  var regex = /\{\{(\w+)\}\}/g;
	var variableNames = [];
	var variableNamesTemplated = [];
    while( match = regex.exec(condition) ){
		variableNames.push( match[1] );
		variableNamesTemplated.push( '{{' + match[1] + '}}' );
	}

	// Then we get an array containing the values corresponding the given variable names.
	var variableValues = [];
	for( var i=0; i<variableNames.length; i++ ){
		var variableName = variableNames[i];
		variableValues[i] = this.variables[variableName];
	}

	// This variable will indicate when a variable in the condition failed to be replaced because the
	// variable did not exist for instance.
	var failedToTemplateCondition = false;

	// Then we replace each of the templated variables with the variable values.
	// The result is a string where all the variable names have been replaced with
	// the corresponding variable values.
    $.each( variableNamesTemplated, function( index, key ){
    	// If the variable value of the current variable is not null and not undefined then
    	// we insert the value into the string.
    	if( variableValues[index] !== undefined && variableValues[index] !== null ){
        	parsedCondition = parsedCondition.replace( key, variableValues[index] );
        } else{
        	// If the variable template could not be replaced because the template did not
        	// correspond to an existing XIMPEL variable, then we set the failedToTemplateCondition
        	// flag to true which indicates that the condition can not be evaluated properly.
        	failedToTemplateCondition = true;
        }
    });

    // the condition string contained variable templates that did not correspond to
    // existing XIMPEL variables. So this condition cannot be evaluated and we
    // return false to indicate the condition is not met.
    if( failedToTemplateCondition === true ){
    	return false;
    }

    // We have a condition that properly parsed, so we eval() them.
	var result = eval( parsedCondition );

	// If the expression returned a non boolean value then we consider the condition to be false.
	return (result === true || result === false) ? result : false;
}



// Determine which subject id should be played next.
ximpel.Player.prototype.determineNextSubjectToPlay = function(){
	var leadsTo = this.determineLeadsTo( this.currentSubjectModel.leadsToList );

	// returns a subject id.
	return leadsTo;
}



// This method handles the end event of the sequence player.
ximpel.Player.prototype.handleSequencePlayerEnd = function(){
	// The sequence player has nothing more to play. If the current subject has a leadsTo
	// attribute, then we jump to that subject.
	var subjectId = this.determineNextSubjectToPlay();
	if( subjectId ){
		 this.goTo( subjectId );
	}

	// There is nothing more to play.... we may want to present an end screen here.

	// Publish the player end event. Any (third party) code that registered a handler for this event using
	// addEventHandler() will have its handler called.
	this.pubSub.publish( this.EVENT_PLAYER_END );

	//add analytics?
}



// Returns the first subject model that is to be played.
ximpel.Player.prototype.getFirstSubjectModel = function(){
	// The first subject to be played is specified in the playlist model (determined in the parser).
	return this.playlistModel.subjectModels[ this.playlistModel.firstSubjectToPlay ];
}



// Add an event handler to listen for events that this Player object throws.
ximpel.Player.prototype.addEventHandler = function( eventName, func ){
	switch( eventName ){
		case this.EVENT_PLAYER_END:
			return this.pubSub.subscribe( this.EVENT_PLAYER_END, func ); break;
		case this.EVENT_VARIABLE_UPDATED:
			return this.pubSub.subscribe( this.EVENT_VARIABLE_UPDATED, func ); break;
		case this.EVENT_SUBJECT_PLAYING:
			return this.pubSub.subscribe( this.EVENT_SUBJECT_PLAYING, func ); break;
		case this.EVENT_SWIPE:
			return this.pubSub.subscribe( this.EVENT_SWIPE, func ); break;
		default:
			ximpel.warn("Player.addEventHandler(): cannot add an event handler for event '" + eventName + "'. This event is not used by the player.");
			break;
			return;
	}
}



// Clear all event handlers that have been registered to this player object.
ximpel.Player.prototype.clearEventHandlers = function( callback ){
	this.pubSub.reset();
	return this;
}



// Cancels a registered event handler for the given eventName and handler function.
ximpel.Player.prototype.clearEventHandler = function( eventName, callback ){
	this.pubSub.unsubscribe( eventName, callback );
}



// The constructMediaItems function takes the list of mediaModels from the playlist object and creates an instance of a media type for each
// mediaModel. These instances are added to the mediaItems property of the player. To access an instance of a media type
// you can do: var mediaItemInstance = this.mediaItems[mediaId]; The mediaId is stored within a mediaModel (determined by the parser).
ximpel.Player.prototype.constructMediaItems = function(){
	var mediaModels = this.getMediaModels();
	
	// For each media model create a media item and store as this.mediaItems[ mediaModel.mediaId ]
	mediaModels.forEach( function( mediaModel ){
		var mediaTypeRegistration = this.availableMediaTypes[ mediaModel.mediaType ];
		var mediaItem = new mediaTypeRegistration['mediaTypeConstructor']( mediaModel.customElements, mediaModel.customAttributes, this.$playerElement, this, mediaModel );
		this.mediaItems[ mediaModel.mediaId ] = mediaItem;
	}.bind(this) );
	
	return this;
}



// returns the player element of this Player() object.
ximpel.Player.prototype.getPlayerElement = function(){
	return this.$playerElement;
}



// Returns the array of mediaModels for the current playlist.
ximpel.Player.prototype.getMediaModels = function(){
	return this.playlistModel.mediaList;
}



// Returns a config property that was specified in the config file or in the playlist file within the <config> element.
// For example getConfigProperty( showControls ) returns the value specified in the config file. For instance: <showControls>true</showControls>
// Return value: the value of the config property or null if the property name doesn't exist.
ximpel.Player.prototype.getConfigProperty = function( propertyName ){
	var value = this.configModel[propertyName];
	if( value !== undefined ){
		return value;
	} else{
		return null;
	}
}

ximpel.Player.prototype.startEmotionDetection = function(){
	var that = this;
  var vid = document.getElementById('videoel');
  var vid_width = vid.width;
  var vid_height = vid.height;
  var overlay = document.getElementById('overlay');
  var overlayCC = overlay.getContext('2d');
  /********** check and set up video/webcam **********/
  function enablestart() {
    var startbutton = document.getElementById('startbutton');
    startbutton.value = "start";
    startbutton.disabled = null;
  }
  function adjustVideoProportions() {
    // resize overlay and video if proportions are different
    // keep same height, just change width
    var proportion = vid.videoWidth/vid.videoHeight;
    vid_width = Math.round(vid_height * proportion);
    vid.width = vid_width;
    overlay.width = vid_width;
  }
  function gumSuccess( stream ) {
    // add camera stream if getUserMedia succeeded
    if ("srcObject" in vid) {
      vid.srcObject = stream;
    } else {
      vid.src = (window.URL && window.URL.createObjectURL(stream));
    }
    vid.onloadedmetadata = function() {
      adjustVideoProportions();
      vid.play();
    }
    vid.onresize = function() {
      adjustVideoProportions();
      if (trackingStarted) {
        ctrack.stop();
        ctrack.reset();
        ctrack.start(vid);
      }
    }
  }
  function gumFail() {
    alert("There was some problem trying to fetch video from your webcam. If you have a webcam, please make sure to accept when the browser asks for access to your webcam.");
  }


  navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  window.URL = window.URL || window.webkitURL || window.msURL || window.mozURL;
  // check for camerasupport
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia({video : true}).then(gumSuccess).catch(gumFail);
  } else if (navigator.getUserMedia) {
    navigator.getUserMedia({video : true}, gumSuccess, gumFail);
  } else {
    alert("This demo depends on getUserMedia, which your browser does not seem to support. :(");
  }
  vid.addEventListener('canplay', enablestart, false);



  /*********** setup of emotion detection *************/
  // set eigenvector 9 and 11 to not be regularized. This is to better detect motion of the eyebrows
  pModel.shapeModel.nonRegularizedVectors.push(9);
  pModel.shapeModel.nonRegularizedVectors.push(11);
  var ctrack = new clm.tracker({useWebGL : true});
  ctrack.init(pModel);
  var trackingStarted = false;
  window.startVideo = function() {
    // start video
    vid.play();
    // start tracking
    ctrack.start(vid);
    trackingStarted = true;
    // start loop to draw face
    drawLoop();
  } 

  function drawLoop() {
    requestAnimFrame(drawLoop);
    overlayCC.clearRect(0, 0, vid_width, vid_height);
    //psrElement.innerHTML = "score :" + ctrack.getScore().toFixed(4);
    if (ctrack.getCurrentPosition()) {
      ctrack.draw(overlay);
    }
    var cp = ctrack.getCurrentParameters();
    var er = ec.meanPredict(cp);
    if (er) {
      updateData(er);
      for (var i = 0;i < er.length;i++) {
        if (er[i].value > 0.4) {
          document.getElementById('icon'+(i+1)).style.visibility = 'visible';
        } else {
          document.getElementById('icon'+(i+1)).style.visibility = 'hidden';
        }
      }
    }
  }
  delete emotionModel['disgusted'];
  delete emotionModel['fear'];
  var ec = new emotionClassifier();
  ec.init(emotionModel);
  var emotionData = ec.getBlank();
  /************ d3 code for barchart *****************/
  var margin = {top : 20, right : 20, bottom : 10, left : 40},
    width = 400 - margin.left - margin.right,
    height = 100 - margin.top - margin.bottom;
  var barWidth = 30;
  var formatPercent = d3.format(".0%");
  var x = d3.scale.linear()
    .domain([0, ec.getEmotions().length]).range([margin.left, width+margin.left]);
  var y = d3.scale.linear()
    .domain([0,1]).range([0, height]);
  var svg = d3.select("#emotion_chart").append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
  svg.selectAll("rect").
    data(emotionData).
    enter().
    append("svg:rect").
    attr("x", function(datum, index) { return x(index); }).
    attr("y", function(datum) { return height - y(datum.value); }).
    attr("height", function(datum) { return y(datum.value); }).
    attr("width", barWidth).
    attr("fill", "#2d578b");
  svg.selectAll("text.labels").
    data(emotionData).
    enter().
    append("svg:text").
    attr("x", function(datum, index) { return x(index) + barWidth; }).
    attr("y", function(datum) { return height - y(datum.value); }).
    attr("dx", -barWidth/2).
    attr("dy", "1.2em").
    attr("text-anchor", "middle").
    text(function(datum) { return datum.value;}).
    attr("fill", "white").
    attr("class", "labels");
  svg.selectAll("text.yAxis").
    data(emotionData).
    enter().append("svg:text").
    attr("x", function(datum, index) { return x(index) + barWidth; }).
    attr("y", height).
    attr("dx", -barWidth/2).
    attr("text-anchor", "middle").
    attr("style", "font-size: 12").
    text(function(datum) { return datum.emotion;}).
    attr("transform", "translate(0, 18)").
    attr("class", "yAxis");
  function updateData(data) {
    // update
    var rects = svg.selectAll("rect")
      .data(data)
      .attr("y", function(datum) { return height - y(datum.value); })
      .attr("height", function(datum) { return y(datum.value); });
    var texts = svg.selectAll("text.labels")
      .data(data)
      .attr("y", function(datum) { return height - y(datum.value); })
      .text(function(datum) { return datum.value.toFixed(1);});
    // enter
    rects.enter().append("svg:rect");
    texts.enter().append("svg:text");
    // exit
    rects.exit().remove();
    texts.exit().remove();

    that.analytics.addFacialExpressions(data);
  }
  /******** stats ********/
  stats = new Stats();
  stats.domElement.style.position = 'absolute';
  stats.domElement.style.top = '0px';
  document.getElementById('container').appendChild( stats.domElement );
  // update stats on every iteration
  document.addEventListener('clmtrackrIteration', function(event) {
    stats.update();
  }, false);
}

// Handles the pan event on the main ximpelPlayer element. If the current subject has a swipe
// property ('swipeLeftTo', 'swipeRightTo', 'swipeUpTo' or 'swipeDownTo') that matches the pan
// direction, we will let the main ximpelPlayer element be dragged in that direction.
ximpel.Player.prototype.onPan = function(event){

	if( ! this.isPlaying() || ! this.currentSubjectModel ){
		ximpel.warn("Player.onPan(): Ignoring event while stopped or paused");
		return this;
	}

	// Scale deltaX and Y to the scale of the $playerElement div.
	var boundingRect = this.$playerElement[0].getBoundingClientRect(),
		scaleX = boundingRect.width / this.$playerElement[0].offsetWidth,
		scaleY = boundingRect.height / this.$playerElement[0].offsetHeight,
		translateX = event.deltaX / scaleX,
		translateY = event.deltaY / scaleY;

	// Check whether there are subjects defined for the horizontal and vertical pan directions.
	var hEvent = (translateX > 0) ? 'swiperight' : 'swipeleft',
		vEvent = (translateY > 0) ? 'swipedown' : 'swipeup';

	if ( ! this.currentSubjectModel.swipeTo[hEvent] && ! this.currentSubjectModel.swipeTo[vEvent] ) {
		// No subject to swipe to in either of the directions, so lets return
		return;
	}

	// We want the pan to be *either* horizontal or vertical, not both at the same time,
	// so if we have subjects defined in both directions, we will choose the major one.
	var panDirection = ( (this.currentSubjectModel.swipeTo[hEvent] && this.currentSubjectModel.swipeTo[vEvent] && Math.abs(translateX) > Math.abs(translateY)) || !this.currentSubjectModel.swipeTo[vEvent] )
		? Hammer.DIRECTION_HORIZONTAL : Hammer.DIRECTION_VERTICAL;

	var translate = (panDirection == Hammer.DIRECTION_HORIZONTAL) ? translateX : translateY;
	var opacity = 1.0 - Math.min(1.0, Math.abs(translate) * 0.0015);
	var scale = 1.0 - Math.min(0.4, Math.abs(translate) * 0.0001);

	var swipeType = (panDirection == Hammer.DIRECTION_HORIZONTAL) ? hEvent : vEvent;
	var nextSubject = this.currentSubjectModel.swipeTo[swipeType];

	if (panDirection == Hammer.DIRECTION_HORIZONTAL) {
		this.$playerElement.css('transform', 'translateX(' + translate + 'px) scale(' + scale + ')');
	} else {
		this.$playerElement.css('transform', 'translateY(' + translate + 'px) scale(' + scale + ')');
	}
	this.$playerElement.css('animation', '');
	this.$playerElement.css('opacity', opacity);

	if (event.isFinal) {
		if (Math.abs(event.velocity) < this.getConfigProperty('minimumSwipeVelocity') || Math.abs(translate) < this.getConfigProperty('minimumSwipeTranslation')) {

			// The pan was either too slow or didn't move far enough, so we just snap back
			this.$playerElement.css('animation', 'swipe 0.5s ease-out forwards');

		} else {

			// Let's do a swipe animation
			if (panDirection == Hammer.DIRECTION_HORIZONTAL) {
				var initPos = this.$playerElement.width() * 0.8 * (translateX > 0 ? -1 : 1);
				this.$playerElement.css('transform', 'translateX(' + initPos + 'px) scale(0.5)');
			} else {
				var initPos = this.$playerElement.height() * 0.8 * (translateY > 0 ? -1 : 1);
				this.$playerElement.css('transform', 'translateY(' + initPos + 'px) scale(0.5)');
			}
			this.$playerElement.css('animation', 'swipe 0.5s ease-out forwards');

			// Change subject
			this.goTo( nextSubject.subject );

			// Publish a swipe event in case anyone's interested
			event.type = swipeType;
			event.nextSubject = nextSubject;
			this.pubSub.publish( this.EVENT_SWIPE, event );
		}
	}
}
