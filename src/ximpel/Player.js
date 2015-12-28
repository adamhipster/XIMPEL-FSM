// ########################################################################################################################################################
// Player()
// The ximpel.Player object is the object that manages the actual playing of the presentation. This object takes a PlaylistModel and
// a ConfigModel and uses that to play a presentation. All the visual elements of the presentation are added to the "playerElement"
// which is also passed to the ximpel.Player constructor.
// ########################################################################################################################################################

// TODO:
// - when the player has nothing more to play it just simply stops leaving the player in state "playing".
//   would be better to show an end screen orso.


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
	// A media item is refered to by its ID. Referring to a media item is done like this: this.mediaItems[<mediaId>]. The result is a media
	// instance (for example a Video() object or an Audio() object) on which methods like play(), pause() and stop() can be called.
	// The media instances will be created and added to the mediaItems object by the constructMediaItems() function.
	this.mediaItems = {};

	// The subjectModel that is currently being played.
	this.currentSubjectModel = null;

	// The pubSub object is used internally by the player for registering event handlers that process events generated by the player.
	this.pubSub = new ximpel.PubSub();

	// The ximpel player can keep track of variables. Variables can be declared and modified using the <score> tag in the playlist.
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

	this.init();
};

ximpel.Player.prototype.STATE_PLAYING = 'state_p_playing';
ximpel.Player.prototype.STATE_PAUSED = 'state_p_paused';
ximpel.Player.prototype.STATE_STOPPED = 'state_p_stopped';


// Do some initialization work, that is only then at the moment of constructing the player.
ximpel.Player.prototype.init = function(){
	// Create an instance for each mediaItem referenced by a mediaModel from the playlist (fill the this.mediaItems object with all media instances).
	this.constructMediaItems();

	// initialize variables
	this.applyVariableModifiers( this.playlistModel.variableModifiers );

	return this;
}


// Reset the player to bring it back into a state where it was in when the Player() was constructed.
// After this method the player is in a stopped state and the play() method can be called as if it
// was the first time the player was being played.
ximpel.Player.prototype.reset = function( clearRegisteredEventHandlers ){
	this.sequencePlayer.stop();
	this.state = this.STATE_STOPPED;
	this.variables = [];
	this.applyVariableModifiers( this.playlistModel.variableModifiers );

	if( clearRegisteredEventHandlers ){
		// resets the pubsub of the sequence player so that all registered callbacks are unregistered.
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


// start playing a given subjectModel.
ximpel.Player.prototype.playSubject = function( subjectModel ){
	// Indicate that the requested subject model is the current model being played.
	this.currentSubjectModel = subjectModel;

	// Each subject contains exactly one sequence model. The sequencePlayer plays such a sequence model. The sequence model itself may contain
	// one or more media models and parrallel models which in turn may contain sequence models again. This playback complexity is all handled by
	// the sequence player so we do not need to worry about that here, we just need to tell the sequence player to start playing the sequence
	// of our subject.
	var sequenceModel = subjectModel.sequenceModel;

	// Apply all variable modifiers that were defined for the subject that is about to play.
	this.applyVariableModifiers( subjectModel.variableModifiers );
	this.sequencePlayer.play( sequenceModel );
}


// Resume playback of the player.
ximpel.Player.prototype.resume = function(){
	// Ignore this resume() call if the player is already in a playing state.
	if( !this.isPaused() ){
		ximpel.warn("Player.resume(): resume() called while not in a paused state.");
		return this;
	}

	// Resume the sequence player.
	this.sequencePlayer.resume();

	// Indicate the player is now in a playing state again.
	this.state = this.STATE_PLAYING;

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

	this.reset();

	return this;
}


// Jump to the subject with the given subjectId.
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
ximpel.Player.prototype.getVariable = function( variableName ){
	return this.variables[variableName];
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

	// If the variable to which the modification is applied hasn't been defined yet, then we define it right here.
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
			break;
		case  variableModifier.OPERATION_SUBSTRACT:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue -= Number( variableModifier.value );
			break;
		case variableModifier.OPERATION_MULTIPLY:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue *= Number( variableModifier.value );
			break;
		case variableModifier.OPERATION_DIVIDE:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue /= Number( variableModifier.value );
			break;
		case variableModifier.OPERATION_POWER:
			var newValue = Number(currentVariableValue) === NaN ? 0 : Number(currentVariableValue);
			newValue = Number( Math.pow(newValue, variableModifier.value ) );
			break;
		default:
			var newValue = currentVariableValue;
	}

	this.variables[ variableModifier.id ] = newValue;
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

// Within the playlist a leadsTo attribute can be added to each subject as well leadsTo elements. Both the leadsTo attributes 
// and the leadsTo element are converted to LeadsToModels by the parser. Whenever the player needs to determine what subject 
// to play next it uses the current subject's list of LeadsToModels and determine which leadsTo model should be used.
// There maybe multiple leadsToModels when you want to specify different leadsTo values for different conditions.
// A LeadsToModel consists of:
// - a subject attribute specifying the subject to play.
// - a condition attribute specifying the condition under which this leadsTo attribute should be used.
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
        	// correspond to an existing XIMPEL variable. So we set the failedToTemplateCondition
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
}


// Returns the first subject model that is to be played.
ximpel.Player.prototype.getFirstSubjectModel = function(){
	return this.playlistModel.subjectModels[ this.playlistModel.firstSubjectToPlay ];
}


// Clear all event handlers that have been registered to this playeer object.
ximpel.Player.prototype.clearEventHandlers = function( callback ){
	this.pubSub.reset();
	return this;
}


// The constructMediaItems function takes the list of mediaModels from the playlist object and creates an instance of a media type for each
// mediaModel. These instances are added to the mediaItems property of the player. To access an instance of a media type
// you can do: var mediaItemInstance = this.mediaItems[mediaId]; The mediaId is stored within a mediaModel.
ximpel.Player.prototype.constructMediaItems = function(){
	var mediaModels = this.getMediaModels();
	
	mediaModels.forEach( function( mediaModel ){
		var mediaTypeRegistration = this.availableMediaTypes[ mediaModel.mediaType ];
		var mediaItem = new mediaTypeRegistration['mediaTypeConstructor']( mediaModel.customElements, mediaModel.customAttributes, this.$playerElement, this );
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


ximpel.Player.prototype.getConfigProperty = function( propertyName ){
	var value = this.configModel[propertyName];
	if( value !== undefined ){
		return value;
	} else{
		return null;
	}
}

// preload all media items... this function should be changed to return a promise, such that it can be checked
// whether the media items have been preloaded. Right now, we immediately return and can start playing even though
// the item that is to be played first may not have been preloaded yet.
/*ximpel.Player.prototype.preloadMediaItems = function(){
	var mediaItemIds = Object.getOwnPropertyNames( this.mediaItems );
	var promises = [];
	mediaItemIds.forEach( function( mediaItemId ){
		var mediaItem = this.mediaItems[ mediaItemId ];
		var promise = mediaItem.preload();
		promises.push( promise );
	}.bind(this) );
	
	// TODO: we should return a promise that combines the promises of the individual preload calls. and resolve that promise if all combined promises resolve.
	return this;
}*/