ximpel.mediaTypeDefinitions.Iframe = function( customEl, customAttr, $el, player ){
   
    this.customElements = customEl;
    this.customAttributes = customAttr;
    this.$parentElement = $el;
    this.player = player;
    
    var iFrameUrl = this.customAttributes.url;
    var iFrameBackgroundColor = this.customAttributes.backgroundColor;
    if(iFrameBackgroundColor == null) {
    	iFrameBackgroundColor = "#000000";
    }
    var containerBackgroundColor = this.customAttributes.containerBackgroundColor;
    if(containerBackgroundColor == null) {
    	containerBackgroundColor = "#000000";
    }
    var iFrameX = this.customAttributes.x;
    if(iFrameX == null) {
    	iFrameX = 0;
    }
    var iFrameY = this.customAttributes.y;
    if(iFrameY == null) {
    	iFrameY = 0;
    }
    var iFrameWidth = this.customAttributes.width;
    if(iFrameWidth == null) {
    	iFrameWidth = 1920;
    }
    var iFrameHeight = this.customAttributes.height;
    if(iFrameHeight == null) {
    	iFrameHeight = 1080;
    }
  
	//use of 'container' property to allow for overlays
	//for now: use margin-left and margin-top to utilize specified x and y values
    this.$iframeSpan = $('<div style="position: absolute; background-color:'+ containerBackgroundColor +'; left:'+iFrameX+'; top:'+iFrameY+';" class="container"></div>');
    
    this.$iframeSpan.html( $('<iframe scrolling="yes" width="' + iFrameWidth + '" height="' + iFrameHeight + '" style="margin-left:'+iFrameX+'; margin-top:'+iFrameY+'; border:0px solid white; top: 0px; background-color:'+ iFrameBackgroundColor +'" wmode="Opaque" src="' + iFrameUrl + '"></iframe>') );
    
    /*this.$iframeSpan.css({
        'color': 'red',
        'font-size': '100px'
    });*/
  
    this.state = 'stopped';
}
ximpel.mediaTypeDefinitions.Iframe.prototype = new ximpel.MediaType();
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaPlay = function(){
    this.state = 'playing';
    this.$parentElement.append( this.$iframeSpan );
}
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaPause = function(){
    this.state = 'paused';
}
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaStop = function(){
    this.state = 'stopped';
    this.$iframeSpan.detach();
}
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaIsPlaying = function(){
    return this.state === 'playing';
}
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaIsPaused = function(){
    return this.state === 'paused';
}
  
ximpel.mediaTypeDefinitions.Iframe.prototype.mediaIsStopped = function(){
    return this.state === 'stopped';
}
 
// Register the media type with XIMPEL
var r = new ximpel.MediaTypeRegistration('iframe', ximpel.mediaTypeDefinitions.Iframe, {
        'allowedAttributes': ['url','width','height','backgroundColor','containerBackgroundColor','x','y'],
        'requiredAttributes': ['url'],
        'allowedChildren': [],
        'requiredChildren': [],
} );
ximpel.registerMediaType( r );