/**
 * Http Proxy Class
 */

var util = require( 'util' )
  , fs = require( 'fs' )
  , url = require( 'url' )
  , http = require( 'http' )
  , iconv = require( 'iconv-lite' )
  , Agent = require( 'agentkeepalive' )
  , Constant = require( '../constant' );

var keepAliveAgent = new Agent( { maxSockets: 1000 } );
var ProxyBase = require( '../proxy' );

// HttpProxy Constructor
function HttpProxy( options ) {
    // ProxyBase.call( this, options );
    this._opt = options || {};

    var urls = this._opt.urls || {};

    if ( this._opt.status === Constant.STATUS_MOCK 
        || this._opt.status === Constant.STATUS_MOCK_ERR ) {
        return;
    }
    var currUrl = urls[ this._opt.status ];

    if ( !currUrl ) {
        throw new Error( 'No url can be proxied! InterfaceId = ' + options.id );
    }
    this._opt.currUrl = currUrl;
    var urlObj = url.parse( currUrl );
    this._opt.hostname = urlObj.hostname;
    this._opt.port = urlObj.port || 80;
    this._opt.path = urlObj.path
                   + ( urlObj.path.indexOf( '?' ) !== -1  ? '&' : '?' )
                   + 'version=' + this._opt.version + '&';
}

// Inherits ProxyBase
util.inherits( HttpProxy, ProxyBase );

// @override requestReal function
HttpProxy.prototype.requestReal = function( params, callback, errCallback, cookie ) {
    
    if ( this._opt.isCookieNeeded === true && cookie === undefined ) {
        throw new Error( 'This request is cookie needed, you must set a cookie for'
            + ' it before request. id = ' + this._opt.id );
    }

    var self = this;

    var options = {
        hostname: self._opt.hostname,
        port: self._opt.port,
        path: self._opt.path,
        method: self._opt.method,
        headers: { 'Cookie': cookie },
        agent: keepAliveAgent,
        keepAlive: true
    };

    var querystring = queryStringify( params );

    if ( self._opt.method === Constant.POST ) {
        options.headers[ 'Content-Type' ] = 'application/x-www-form-urlencoded';
        options.headers[ 'Content-Length' ] = querystring.length;

    } else if ( self._opt.method === Constant.GET ) {
        options.path += querystring;
    }

    var timer = setTimeout( function() {
        errCallback( new Error( 'timeout' ) );
    }, self._opt.timeout || 5000 );

    var req = http.request( options, function( res ) {
        var source = [], size = 0;
        res.on( 'data', function( chunk ) {
            source.push( chunk );
            size += chunk.length;
        } );
        res.on( 'end', function() {
            var buffer = Buffer.concat( source, size );
            clearTimeout( timer );

            if ( res.statusCode !== 200 ) {
                var e = new Error( 'Response error. '
                    + ' interfaceId = ' + self._opt.currUrl
                    + ', url = ' + self._opt.currUrl
                    + ', statusCode = ' + res.statusCode );
                e.statusCode = res.statusCode;
                e.responseText = buffer.toString();
                errCallback( e );
                return;
            }
            try {
                var result = self._opt.encoding === Constant.ENCODING_RAW 
                    ? buffer
                    : ( self._opt.dataType !== Constant.JSON && self._opt.dataType !== Constant.JSONP
                        ? iconv.fromEncoding( buffer, self._opt.encoding )
                        : JSON.parse( iconv.fromEncoding( buffer, self._opt.encoding ) ) );
            } catch ( e ) {
                clearTimeout( timer );
                errCallback( new Error( 'The result has syntax error. interfaceId = ' 
                    + self._opt.id + ', url = ' + self._opt.currUrl + '. Caused By: ' + e.message ) );
                return;
            }
            callback( result, res.headers['set-cookie'] );
        } );

        res.on( 'error', function( e ) {
            clearTimeout( timer );
            e.message = 'Response failed. interfaceId = ' + self._opt.id  +', url = ' 
                + self._opt.currUrl + '. Caused By: ' + e.message; 
            errCallback( e );
        } );
    } );

    self._opt.method !== Constant.POST || req.write( querystring );
    req.on( 'error', function( e ) {
        clearTimeout( timer );
        e.message = 'Request failed. interfaceId = ' + self._opt.id  +', url = ' 
            + self._opt.currUrl + '. Caused By: ' + e.message; 
        errCallback( e );
    } );

    req.end();
};

// @override interceptRequest
HttpProxy.prototype.interceptRequest = function( req, res ) {
    
    var self = this;
    var options = {
        hostname: self._opt.hostname,
        port: self._opt.port,
        path: self._opt.path + req.url.replace( /^[^\?]*\?/, '' ),
        method: self._opt.method,
        headers: req.headers,
        agent: keepAliveAgent,
        keepAlive: true
    };

    options.headers.host = self._opt.hostname;
    // delete options.headers.referer;
    // delete options.headers['x-requested-with'];
    // delete options.headers['connection'];
    // delete options.headers['accept'];
    delete options.headers[ 'accept-encoding' ];
    
    var req2 = http.request( options, function( res2 ) {
        var source = [], size = 0;

        res2.on( 'data', function( chunk ) {
            source.push( chunk );
            size += chunk.length;
        } );

        res2.on( 'end', function() {
            var buffer = Buffer.concat( source, size );
            var result;
            try {
                result = self._opt.encoding === Constant.ENCODING_RAW 
                    ? buffer
                    : iconv.fromEncoding( buffer, self._opt.encoding );
            } catch ( e ) {
                res.statusCode = 500;
                res.end( e + '' );
                return;
            }
            res.setHeader( 'Set-Cookie', res2.headers['set-cookie'] );
            res.statusCode = res2.statusCode;
            res.setHeader( 'Content-Type', res2.headers[ 'Content-Type' ] );
            res.end( result );
        } );
        res2.on( 'error', function( err ) {
            res.statusCode = 500;
            res.end( e + '' );
        } );
    } );

    req2.on( 'error', function( e ) {
        res.statusCode = 500;
        res.end( e + '' );
    } );
    req.on( 'data', function( chunck ) {
        req2.write( chunck );
    } );
    req.on( 'end', function() {
        req2.end();
    } );
};

function queryStringify( params ) {
    if ( !params || typeof params === 'string' ) {
        return params || '';
    } else if ( params instanceof Array ) {
        return params.join( '&' );
    }
    var qs = [], val;
    for ( var i in params ) {
        val = typeof params[i] === 'object' 
            ? JSON.stringify( params[ i ] )
            : params[ i ];
        qs.push( i + '=' + encodeURIComponent(val) );
    }
    return qs.join( '&' );
};


HttpProxy.init = function( config ) {

};

HttpProxy.verify = function( prof, InterfaceManager ) {
    if ( !(prof.status in prof.urls
        || prof.status === Constant.STATUS_MOCK
        || prof.status === Constant.STATUS_MOCK_ERR ) ) {
        prof.status = InterfaceManager.getStatus();
    }
    
    function isUrlsValid( urls ) {
        if ( !urls ) return false;
        for ( var i in urls ) {
            return true;
        }
        return false;
    }

    if ( !isUrlsValid( prof.urls )
            && !fs.existsSync( prof.ruleFile ) ) {
        throw new Error( 'Profile is deprecated:\n', 
            prof, '\nNo urls is configured and No ruleFile is available' );
    }

    prof.engine              = prof.engine || InterfaceManager.getEngine();
    prof.method              = { POST: 'POST', GET:'GET' }
                             [ (prof.method || 'GET').toUpperCase() ];
    prof.dataType            = { json: 'json', text: 'text', jsonp: 'jsonp' }
                             [ (prof.dataType || 'json').toLowerCase() ];
    prof.isRuleStatic        = !!prof.isRuleStatic || false;
    prof.isCookieNeeded      = !!prof.isCookieNeeded || false;
    prof.timeout             = prof.timeout || 2000;
    prof.version             = prof.version || '';
    prof.bypass              = !!prof.bypassProxyOnClient;
    prof.url                 = ( prof.status !== Constant.STATUS_MOCK 
                                && prof.status !== Constant.STATUS_MOCK_ERR ) 
                                ? prof.urls[ prof.status ] : '';

    if ( prof.status === Constant.STATUS_MOCK || prof.status === Constant.STATUS_MOCK_ERR ) {
        prof.bypass = false;
        // prof.dataType = prof.dataType === Constant.JSONP ? Constant.JSON : Constant.TEXT;
    }

    return prof;
};

module.exports = HttpProxy;