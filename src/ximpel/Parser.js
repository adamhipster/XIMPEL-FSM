// Parser()
// The main method of the parser is .parse() which takes an XMLDoc of the playlist and config.
// The parser processes these XML docs by traversing the node tree recursively and calling a processor 
// for each node it encounters. The final result is a PlaylistModel and a ConfigModel.

// ########################################################################################################################################################

// TODO:
// 	- Check if the shape of an overlay is valid (ie. if square then the "sides" attribute must exist, if rectangle then width and height must exist etc.)
//	- Start using the this.validChildren object to enforce only using validChildren
//  - Start making sure that units are specified. (note that width/heights/x and y should have units specified, if not given then we should add 'px'.)
//  - Right now for the media type nodes we store the custom elements in a special format. We should probably just store the raw DOM elements.

// The constructor function to create instances of this Parser() object.
ximpel.Parser = function(){
	// The mediaTypeRegistrations variable is an object that contains the registrations of the media types.
	// This is needed by the parser to know which custom media tags can be used and which child-tags and attributes 
	// are allowed on the custom media tag. It is stored in the form: {'<mediaTypeId>': <MediaTypeRegistrationObject>, ... }
	this.mediaTypeRegistrations = ximpel.availableMediaTypes;

	// Get an array containing the media type ID's (ie. tag names) that are allowed to be used in the playlist.
	this.registeredMediaTags = Object.getOwnPropertyNames( this.mediaTypeRegistrations );
	
	// An object that defines which children are allowed on each of the elements.
	this.validChildren = {
		'ximpel': 	['playlist','config'],
		'playlist': ['subject', 'score'],
		'subject': 	['description', 'media', 'score', 'sequence', 'parallel'],
		'media': 	['parallel', 'sequence'].concat(this.registeredMediaTags), // add the custom media tags to the allowed children of <media>
		'parallel': ['media', 'sequence'].concat(this.registeredMediaTags), 	// add the custom media tags to the allowed children of <parallel>
		'sequence': ['parallel'].concat(this.registeredMediaTags), 	// add the custom media tags to the allowed children of <sequence>;
		'overlay': 	['score'],
 		'score': 	[''],
 		'question':	[''],
 		'description': [''],
		'config': [''],
		// We want to define valid children that will apply to each custom media type, we use __MEDIA_TYPE__ for this.
		 '__MEDIA_TYPE__': ['overlay', 'score', 'question'], // ie. these tags are valid children for each custom media type.
	}

	// This counter is used to give each media item a unique ID that is used within ximpel to refer to that media item.
	this.mediaIdCounter = 1;
}


// The parse() method takes two xmlDoc objects as argument for the the playlist and config file. The config XMLDoc is optional.
// Return value: 	Object in the form: {'playlist': <playlistModelObject>, 'config': <configModelObject>}
ximpel.Parser.prototype.parse = function( playlistXml, configXml ){
	// First we parse the playlist file and get a PlaylistModel() and a ConfigModel() (ie. config can also be specified in the playlist)
	var playlistParseResult = this.parseXml( playlistXml );
	var playlistModel = playlistParseResult['playlist'] || null;
	var playlistConfigModel = playlistParseResult['config'];

	// If no PlaylistModel was returned then something went wrong during the parsing of the playlist.
	if( !playlistModel ){
		ximpel.error("Parser.parser(): Failed to parse the playlist file. The playlist file is invalid.");
		return false;
	}

	// If a config xmlDoc is specified then parse it (the config doc is optional).
	if( configXml ){
		// Parse the given config XML. The result is a ConfigModel() object or an empty object if it is invalid.
		var configParseResult = this.parseXml( configXml );
		var configModel = configParseResult['config'] || null;
		if( !configModel ){
			ximpel.error("Parser.parse(): Failed to parse the config file. The config file is invalid.");
			return false;
		}
	} else{
		// No config XML content specified, so just create a new ConfigModel() object containing the default values.
		var configModel = new ximpel.ConfigModel();
	}

	// Configuration settings can be defined both in a seperate config file, as well as in a config node within the playlist file. If the 
	// playlist file contained a <config> node, then use these config settings to overwrite the settings specified in the config XML file.
	if( playlistConfigModel ){
		configModel.extend( playlistConfigModel );
	}

	return {'playlist': playlistModel, 'config': configModel };
}



// This method parses the given XML document. Depending on the content of the xmlDoc it will return a playlist
// object or a Config object. Or false if the xmlDoc is not a valid ximpel document.
ximpel.Parser.prototype.parseXml = function( xmlDoc ){
	// Get the root element (ie. the <ximpel> element).
	var ximpelNode = xmlDoc.childNodes[0];

	// Check if the XML document was empty.
	if( !ximpelNode ){
		ximpel.error("Parser.parseXml(): Cannot parse the XML contents, the given XML document is empty");
		return null; 
	}
	
	// Check if the root element is <ximpel> (it must be)
	if( ximpelNode.nodeName !== 'ximpel' ){
		ximpel.error("Parser.parseXML(): Invalid document specified. The Root element must be the <ximpel> element.");
		return null;
	}

	// process the ximpel node. 
	var result = this.processXimpelNode( ximpelNode );
	return result;
}



// Process the <ximpel> node. The result looks like:
// {'playlist': <PlaylistModel>, 'config': <ConfigModel>}
// where both the playlist and config may exist, of just one of those.
ximpel.Parser.prototype.processXimpelNode = function( domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var result = {};

	// The ximpel node can have a playlist child-node, a config child-node, or both. We process each child node.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];

		if( child.nodeName === 'playlist' ){
			// Get a PlaylistModel based on this <playlist> node.
			result['playlist'] = this.processPlaylistNode( child );
		} else if( child.nodeName === 'config' ){
			// Get a ConfigModel based on this <config> node.
			result['config'] = this.processConfigNode( child );
		} else{
			ximpel.warn('Parser.processXimpelNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+child.nodeName+'>. Allowed children: ' + this.validChildren[info.tagName].toString() + '.');
		}
	}
	return result;
}



// Process the <playlist> node.
ximpel.Parser.prototype.processPlaylistNode = function( domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	
	// This will contain the subjectId of the subject that should start to play first.
	var firstSubjectToPlay = null;
	
	var playlistModel = new ximpel.PlaylistModel();

	// Process each of the <playlist>'s child elements
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];

		if( child.nodeName === 'subject' ){
			var subjectModel = this.processSubjectNode( playlistModel, child );

			// Store the subjectModels based on their subjectId so that they can be retrieved using subjectModels[subjectId]
			playlistModel.subjectModels[subjectModel.subjectId] = subjectModel;

			// By default, the subject that appears first in the playlist file is the one that will be played first.
			if( firstSubjectToPlay === null ){
				// firstSubjectToPlay has not been set yet, so this is the first subject and we store its ID.
				firstSubjectToPlay = subjectModel.subjectId;
			}
		} else if( child.nodeName === 'score' || child.nodeName === 'variable' ){
			var variableModifierModel = this.processVariableNode( playlistModel, child );
			playlistModel.variableModifiers.push( variableModifierModel );
		} else{
			ximpel.warn('Parser.processPlaylistNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+child.nodeName+'>. Allowed children: ' + this.validChildren[info.tagName].toString() + '.');
		}
	}

	playlistModel.firstSubjectToPlay = firstSubjectToPlay;
	return playlistModel;
}



// Process a <subject> node.
ximpel.Parser.prototype.processSubjectNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var subjectModel = new ximpel.SubjectModel();

	// Process and store the attributes of the <subject> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'id' ){
			subjectModel.subjectId = attributeValue;
		} else if( attributeName === 'leadsTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			subjectModel.leadsToList.push( leadsToModel );
		} else if( attributeName === 'swipeLeftTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			subjectModel.swipeTo.swipeleft = leadsToModel;
		} else if( attributeName === 'swipeRightTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			subjectModel.swipeTo.swiperight = leadsToModel;
		} else if( attributeName === 'swipeUpTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			subjectModel.swipeTo.swipeup = leadsToModel;
		} else if( attributeName === 'swipeDownTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			subjectModel.swipeTo.swipedown = leadsToModel;
		}  else{
			ximpel.warn('Parser.processSubjectNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Process and store the child elements of the <subject> element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;

		if( childName === 'description' ){
			subjectModel.description = this.processDescriptionNode( playlistModel, child );
		} else if( childName === 'media'){
			subjectModel.sequenceModel = this.processMediaNode( playlistModel, child );
		} else if( childName === 'sequence'){
			subjectModel.sequenceModel = this.processSequenceNode( playlistModel, child );
		} else if( childName === 'parallel'){
			subjectModel.parallelModel = this.processParallelNode(playlistModel, child );
		} else if( childName === 'score' || childName === 'variable' ){
			var variableModifier = this.processVariableNode( playlistModel, child );
			subjectModel.variableModifiers.push( variableModifier );
		} else if( childName === 'leadsTo' ){
			var leadsToModel = this.processLeadsToNode( playlistModel, child );
			subjectModel.leadsToList.push( leadsToModel );
		} else {
			ximpel.warn('Parser.processSubjectNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString() + '.');
		}
	}

	return subjectModel;
}



// Process the <media> node.
ximpel.Parser.prototype.processMediaNode = function( playlistModel, domElement ){
	// The media node is just there to indicate that within this <media> </media section
	// there will be media items (like <video> and <audio>). However in essence this just
	// indicates a sequence of media items. Therefore we process it as if it were a <sequence>
	// node. So the result will be a SequenceModel object
	return this.processSequenceNode( playlistModel, domElement );
}

// Process a <sequence> node, the result is a SequenceModel
ximpel.Parser.prototype.processSequenceNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var sequenceModel = new ximpel.SequenceModel();

	// Process and store the attributes of the <sequence> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'order' ){
			sequenceModel.order = attributeValue;
		} else{
			ximpel.warn('Parser.processSequenceNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Process and store the child elements of the parent element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;

		if( $.inArray( childName, this.registeredMediaTags ) > -1 ){
			// The child-node is a registered media item... (<video>, or <audio>, etc.)
			sequenceModel.add( this.processMediaTypeNode( playlistModel, child ) );
		} else if( childName === 'parallel' ){
			sequenceModel.add( this.processParallelNode( playlistModel, child ) );
		} else if( childName === 'sequence' ){
			sequenceModel.add( this.processSequenceNode( playlistModel, child ) );
		} else{
			ximpel.warn('Parser.processSequenceNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString()  + '.');
		}
	}
	return sequenceModel;
}

// Process the <parallel> node. The result is a ParallelModel object.
ximpel.Parser.prototype.processParallelNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var parallelModel = new ximpel.ParallelModel();

	// Process and store the child elements of the <parallel> element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;
		
		if( $.inArray( childName, this.registeredMediaTags ) > -1 ){
			// The child-node is a registered media item...
			parallelModel.add( this.processMediaTypeNode( playlistModel, child ) );
		} else if( childName === 'sequence' ){
			parallelModel.add( this.processSequenceNode( playlistModel, child ) );
		} else if( childName === 'media'){
			parallelModel.add( this.processMediaNode( playlistModel, child ) );
		} else{
			ximpel.warn('Parser.processParallelNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString()  + '.');
		}
	}
	return parallelModel;
}



// Process a media type node like <video> or <picture>. The result is a MediaModel object.
ximpel.Parser.prototype.processMediaTypeNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var mediaModel = new ximpel.MediaModel();

	// The mediaType is stored in the media model, this indicates the tagName / name of the media type.
	mediaModel.mediaType = info.tagName;

	// Store the information on the attributes of the media item tag in the MediaModel.
	// For instance in the case of: <video width=".." leadsto="..." /> we store: "width" and "leadsTo" attribute information.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;

		if( attributeName === 'leadsTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			mediaModel.leadsToList.push( leadsToModel );
		} else if( attributeName === 'duration' ){
			// Store the duration is miliseconds.
			mediaModel.duration = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'repeat' ){
			mediaModel.repeat = attributeValue === "true" ? true : false;
		} else{
			// The media model has a 'customAttributes' property which stores all the attributes that are not known to ximpel.
			// We do this because these attributes may be used by the media type which ximpel knows nothing about.
			// The media type implementation can access them by doing: customAttributes['nameOfAttribute']
			mediaModel.customAttributes[attributeName] = attributeValue;
		}
	}

	// Process and store the child elements of the custom media type element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;

		if( childName === 'overlay' ){
			mediaModel.overlays.push( this.processOverlayNode( playlistModel, child, i ) );
		} else if( childName === 'score' || childName === 'variable' ){
			var variableModifier = this.processVariableNode( playlistModel, child );
			mediaModel.variableModifiers.push( variableModifier );
		} else if( childName === 'question' ){
			mediaModel.questionLists.push( this.processQuestionNode( playlistModel, child ) );
		} else if( childName === 'questions' ){
			mediaModel.questionLists.push( this.processQuestionsNode( playlistModel, child ) );
		} else if( childName === 'leadsTo' ){
			var leadsToModel = this.processLeadsToNode( playlistModel, child );
			mediaModel.leadsToList.push( leadsToModel );
		} else{
			// If the name of the child element is unknown then we assume its a custom element for the media type.
			// We pass this customElements information to the Media Type implementation.
			var childAttributes = {};
			for( var j=0; j<child.attributes.length; j++ ){
				childAttributes[child.attributes[j].name] = child.attributes[j].value;
			}
			var customElementModel = new ximpel.CustomElementModel( childName, childAttributes );
			mediaModel.customElements.push( customElementModel );
		}
	}
	
	// We set the mediaId to a unique ID value which we use to distinguish the media items.
	mediaModel.mediaId = this.mediaIdCounter++;

	// we add the media items to mediaList of the playlistModel.
	playlistModel.mediaList.push( mediaModel ); 

	return mediaModel;
}



// Process the <questions> node. The result is a QuestionListModel object.
ximpel.Parser.prototype.processQuestionsNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var questionListModel = new ximpel.QuestionListModel();

	// Process and store the attributes of the <questions> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'startTime' ){
			questionListModel.startTime = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'questionTimeLimit' ){
			questionListModel.questionTimeLimit = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'nrOfQuestionsToAsk' ){
			questionListModel.nrOfQuestionsToAsk = parseInt(attributeValue);
		} else if( attributeName === 'questionOrder' ){
			questionListModel.questionOrder = attributeValue;
		} else{
			ximpel.warn('Parser.processQuestionsNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Process and store the child elements of the <questions> element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;
		
		if( childName === 'question' ){
			questionListModel.questions.push( this.processQuestionNode( playlistModel, child ) );
		} else{
			ximpel.warn('Parser.processQuestionsNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString()  + '.');
		}
	}
	return questionListModel;
}



// Process the <question> node. The result is a QuestionModel()
ximpel.Parser.prototype.processQuestionNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var questionModel = new ximpel.QuestionModel();
	var hasExplicitQuestionList = domElement.parentNode.nodeName === 'questions' ? true : false;

	// Process and store the attributes of the <question> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;

		if( attributeName === 'startTime' && hasExplicitQuestionList === false ){
			questionModel.startTime = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'questionTimeLimit' ){
			questionModel.questionTimeLimit = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'answer' ){
			questionModel.answer = attributeValue;
		} else{
			ximpel.warn('Parser.processQuestionNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Find the textnode within the <question> tag (ie. the actual question being asked.) Example:
	// <question>How old is a cow?<option>1 year</option><option>5 years</option></question>
	// So in this example we will get the text: "How old is a cow?"
	var questionText = "";
	// We loop over all child nodes of the <question> element
	for( var i=0; i<domElement.childNodes.length; i++ ){
		var node = domElement.childNodes[i];
		if( node.nodeType === 3 ){
			// If the child node is a textnode (ie. nodeType === 3), then we add the text to our result
			// Note that we must finish the loop, because sometimes the text is put into seperate text nodes.
			// so we must add each of the textnodes.
			questionText += domElement.childNodes[i].nodeValue;
		}
	}
	// Strip off the whitespace/newline characters around the textnode.
	questionModel.questionText = $.trim( questionText );

	// Process and store the child elements of the <question> element.
	var nrOfOptions=0;
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;
		
		if( childName === 'option' ){
			nrOfOptions+=1;
			var optionModel = this.processOptionNode( playlistModel, child );
			// If the option was not given a name attribute, then we set the optionName equal to the
			// index of the option plus 1. So the first options is named 1, the second option named 2 etc.
			optionModel.optionName = optionModel.optionName === "" ? ""+nrOfOptions : optionModel.optionName;
			questionModel.options.push( optionModel );
		} else if( childName === 'score' || childName === 'variable' ){
			var variableModifier = this.processVariableNode( playlistModel, child );
			questionModel.variableModifiers.push( variableModifier );
		} else{
			ximpel.warn('Parser.processQuestionNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString()  + '.');
		}
	}

	// If no options were given then we consider it to be a true false question so we create true/false options.
	if( questionModel.options.length <= 0 ){
		var trueOption = new ximpel.QuestionOptionModel();
		trueOption.optionName = "true";
		trueOption.optionText = "True";
		var falseOption = new ximpel.QuestionOptionModel();
		falseOption.optionName = "false";
		falseOption.optionText = "False";
		questionModel.options.push( trueOption );
		questionModel.options.push( falseOption );
	}

	// The <questions> tag is used to group a set of questions together. Every <question> belongs to a list of questions. 
	// All questions that are within the same <questions> tag, are considered to be part of the same question list. 
	// However, if you don't explicitly wrap a question in a <questions> tag, then the <question> is considered to be 
	// its own list of just one question. So if the question is not explicitly added to a <questions> tag then we let
	// this function create a QuestionListModel just for this one question.
	if( !hasExplicitQuestionList ){
		var questionList = new ximpel.QuestionListModel();
		questionList.startTime = questionModel.startTime || 0;
		questionList.questions.push( questionModel );
		return questionList;
	} 

	return questionModel;
}



// Process an <option> node. The result is an OptionModel object.
ximpel.Parser.prototype.processOptionNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var optionModel = new ximpel.QuestionOptionModel();

	// Process and store the attributes of the <option> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;

		if( attributeName === 'name' ){
			optionModel.optionName = attributeValue;
		} 
		ximpel.warn('Parser.processOptionNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
	}

	// Find the textnode within the <option> tag (ie. the actual option text to be shown.)
	var optionText = "";
	for( var i=0; i<domElement.childNodes.length; i++ ){
		if( domElement.childNodes[i].nodeType === 3 ){
			// If the child node is a textnode (ie. nodeType === 3), then we add the text to our result
			// Note that we must finish the loop, because sometimes the text is put into seperate text nodes.
			// so we must add each of the textnodes.
			optionText += domElement.childNodes[i].nodeValue;
		}
	}
	// Strip off the whitespace/newline characters around the text.
	optionModel.optionText = $.trim( optionText );
	
	return optionModel;
}



// Process the <variable> node. The result is a VariableModifierModel object.
ximpel.Parser.prototype.processVariableNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var variableModifierModel = new ximpel.VariableModifierModel();

	// Process and store the attributes of the element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'id' ){
			variableModifierModel.id = attributeValue;
		} else if( attributeName === 'operation' ){
			variableModifierModel.operation = attributeValue;
		} else if( attributeName === 'value' ){
			variableModifierModel.value = attributeValue;
		} else{
			ximpel.warn('Parser.processVariableNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Process and store the child elements of the element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;
		
		// No child nodes supported for the score element.
		ximpel.warn('Parser.processVariableNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. No children allowed on <'+info.tagName+'>.');
	}

	return variableModifierModel;
}



// Process the >leadsTo> node. The result is a LeadsToModel object.
ximpel.Parser.prototype.processLeadsToNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var leadsToModel = new ximpel.LeadsToModel();


	// Process and store the attributes of the leadsTo element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'condition' ){
			var condition = attributeValue;
		} else if( attributeName === 'subject' ){
			leadsToModel.subject = attributeValue
		} else{
			ximpel.warn('Parser.processLeadsToNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// If a condition attribute was specified on the <leadsTo> node.
	// Then we create a ConditionModel object and store it in our LeadsToModel.
	if( condition  ){
		var conditionModel = new ximpel.ConditionModel();
		conditionModel.condition = condition ? condition : null;
		leadsToModel.conditionModel = conditionModel;
	} else{
		leadsToModel.conditionModel = null;

	}
	return leadsToModel;
}



// Process the <description> node. The result is a string containing the description.
ximpel.Parser.prototype.processDescriptionNode = function( playlistModel, domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var childNode = domElement.childNodes[0];
	var description = "";

	
	if( !childNode ){
		// Nothing was specified between <description> and </description> so the description is empty.
		description = "";
	} else if( childNode.nodeType === 3 ){ 
		// text was specified between <description> and </description> (ie. node type === 3)
		description = $.trim( childNode.nodeValue );
	} else{
		// A non textnode was specified between <description> and </description>, probably an XML tag, which is not allowed.
		ximpel.warn('Parser.processDescriptionNode(): Invalid description! Element <'+info.tagName+'> has an invalid child node. Only text is allowed inside the <description> element.');
	}

	return description;
}



// Process the <overlay> node. The result is an OverlayModel object.
ximpel.Parser.prototype.processOverlayNode = function( playlistModel, domElement, index ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var overlayModel = new ximpel.OverlayModel();

	// Store index for stable sorting
	overlayModel.index = index;

	// Process and store the attributes of the <overlay> element.
	for( var i=0; i<info.nrOfAttributes; i++ ){
		var attributeName = info.attributes[i].name;
		var attributeValue = info.attributes[i].value;
		if( attributeName === 'x' ){
			overlayModel.x = parseInt(attributeValue);
		} else if( attributeName === 'y' ){
			overlayModel.y = parseInt( attributeValue);
		} else if( attributeName === 'shape' ){
			overlayModel.shape = attributeValue;
		} else if( attributeName === 'width' ){
			overlayModel.width = parseInt(attributeValue);
		} else if( attributeName === 'height' ){
			overlayModel.height = parseInt(attributeValue);
		} else if( attributeName === 'side' ){
			overlayModel.side = parseInt(attributeValue);
		} else if( attributeName === 'diameter' ){
			overlayModel.diameter = parseInt(attributeValue);
		} else if( attributeName === 'leadsTo' ){
			var leadsToModel = new ximpel.LeadsToModel();
			leadsToModel.subject = attributeValue;
			overlayModel.leadsToList.push( leadsToModel );
		} else if( attributeName === 'startTime' ){
			overlayModel.startTime = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'duration' ){
			overlayModel.duration = parseFloat(attributeValue)*1000;
		} else if( attributeName === 'text' ){
			overlayModel.text = attributeValue;
		} else if( attributeName === 'alpha' ){
			overlayModel.opacity = attributeValue;
		} else if( attributeName === 'hoverAlpha' ){
			overlayModel.hoverOpacity = attributeValue;
		} else if( attributeName === 'backgroundColor' ){
			overlayModel.backgroundColor = attributeValue;
		} else if( attributeName === 'hoverBackgroundColor' ){
			overlayModel.hoverBackgroundColor = attributeValue;
		} else if( attributeName === 'textColor' ){
			overlayModel.textColor = attributeValue;
		} else if( attributeName === 'hoverTextColor' ){
			overlayModel.hoverTextColor = attributeValue;
		} else if( attributeName === 'fontFamily' ){
			overlayModel.fontFamily = attributeValue;
		} else if( attributeName === 'hoverFontFamily' ){
			overlayModel.hoverFontFamily = attributeValue;
		} else if( attributeName === 'fontSize' ){
			overlayModel.fontSize = attributeValue;
		} else if( attributeName === 'hoverFontSize' ){
			overlayModel.hoverFontSize = attributeValue;
		} else if( attributeName === 'image' ){
			overlayModel.backgroundImage = attributeValue;
		} else if( attributeName === 'hoverImage' ){
			overlayModel.hoverBackgroundImage = attributeValue;
		} else if( attributeName === 'waitForMediaComplete' ){
			overlayModel.waitForMediaComplete = attributeValue;
		} else if( attributeName === 'description' ){
			overlayModel.description = attributeValue;
		} else{
			ximpel.warn('Parser.processOverlayNode(): Invalid attribute ignored! Attribute \''+attributeName+'\' on element <'+info.tagName+'> is not supported. Make sure you spelled the attribute name correctly.');
		}
	}

	// Process and store the child elements of the <overlay> element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;

		if( childName === 'score' || childName === 'variable' ){
			var variableModifier = this.processVariableNode( playlistModel, child );
			overlayModel.variableModifiers.push( variableModifier );
		} else if( childName === 'leadsTo' ){
			var leadsToModel = this.processLeadsToNode( playlistModel, child );
			overlayModel.leadsToList.push( leadsToModel );
		} else{
			ximpel.warn('Parser.processOverlayNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>. Allowed children: ' + this.validChildren[info.tagName].toString()  + '.');
		}
	}
	return overlayModel;
}



// Process the <config> node. The result is a ConfigModel object.
ximpel.Parser.prototype.processConfigNode = function( domElement ){
	// Get some info about the current domElement (like its parent, its children, etc)
	var info = this.getDomElementInfo( domElement );
	var configModel = new ximpel.ConfigModel();
	
	// Process and store the child elements of the <config> element.
	for( var i=0; i<info.nrOfChildElements; i++ ){
		var child = info.childElements[i];
		var childName = child.nodeName;

		if( childName === 'enableControls' ){
			configModel.enableControls = ( $.trim(child.textContent).toLowerCase() === 'false') ? false : true;
		} else if( childName === 'controlsDisplayMethod' ){
			configModel.controlsDisplayMethod = $.trim(child.textContent);
		} else if( childName === 'mediaDirectory' ){
			configModel.mediaDirectory = $.trim(child.textContent);
		} else if( childName === 'showScore' ){
			configModel.showScore = ( $.trim(child.textContent).toLowerCase() === 'true');
		} else if( childName === 'minimumSwipeVelocity' ){
			configModel.minimumSwipeVelocity = parseFloat(child.textContent);
		} else if( childName === 'minimumSwipeTranslation' ){
			configModel.minimumSwipeTranslation = parseFloat(child.textContent)
		}
		else{
			ximpel.warn('Parser.processConfigNode(): Invalid child ignored! Element <'+info.tagName+'> has child <'+childName+'>.This child element is not allowed on <'+info.tagName+'>.');
		}
	}

	return configModel;
}



// element.children gives the child nodes that are of type 'element'. However, the element.children attribute
// does not work in IE on XML elements. This function is used to get the child elements also for IE browsers.
// Note that for internet explorer we return an array while for other browsers we return domElement.children 
// which doesn't actually return an array but something that looks and functions alot like an array.
ximpel.Parser.prototype.getChildElementNodes = function( domElement ){
	if( domElement.children ){
		// for all browsers
		return domElement.children;
	} else{
		// For internet explorer
		var nrOfChildNodes = domElement.childNodes.length;
		var children = [];
		for( var i=0; i < nrOfChildNodes; i++ ){
    		var child = domElement.childNodes[i];
    		if( child.nodeType === 1 ){
    			children.push( child );
    		}
		}
		return children;
	}
}


// Returns an object containing some information about the given domElement
// This information includes the tagName, the attributes, the number of attributes, the childElements, etc.
ximpel.Parser.prototype.getDomElementInfo = function( domElement ){
	var domElementInfo = {};

	// Get the name (tag) of the DOM element (ie. for <ximpel> it returns gets "ximpel")
	domElementInfo.tagName = domElement.nodeName;

	// Get the attributes of the DOM element.
	domElementInfo.attributes = domElement.attributes;

	// Get the nr of attributes on the DOM element.
	domElementInfo.nrOfAttributes = domElementInfo.attributes.length;

	// Get the child DOM nodes of type 'element' (returns an array like object)
	domElementInfo.childElements = this.getChildElementNodes( domElement );

	// Get the number of child DOM nodes of type 'element'
	domElementInfo.nrOfChildElements = domElementInfo.childElements.length;

	return domElementInfo;
}