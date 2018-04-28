// Workaround for https://github.com/google/google-api-javascript-client/issues/260
// (https://apis.google.com/js/api.js doesn't work if third-party session storage is disabled).

(function() {

var patchedScriptOnload = false;
var patchedGapiLoad = false;
var patchedGapiAuth2Init = false;

tryPatchGapi();

function tryPatchGapi() {
  if (!window.gapi) {
    if (!patchedScriptOnload) {
      for (let script of document.getElementsByTagName('script')) {
        if (script.src.match(/^https:[/][/]apis[.]google[.]com[/]js[/]/)) {
          patchedScriptOnload = true;
          if (script.onload) {
            console.log('gapi-issue260: Installing onload patcher to', script);
            let scriptOnload = script.onload;
            script.onload = function(e) {
              tryPatchGapi();
              scriptOnload(e);
            };
          } else {
            console.log('gapi-issue260: Installing "load" event patcher to', script);
            script.addEventListener('load', tryPatchGapi);
          }
        }
      }
    }
    return;
  }

  if (!gapi.auth2) {
    if (!patchedGapiLoad) {
      patchedGapiLoad = true;
      console.log('gapi-issue260: Patching gapi.load.');
      let gapiLoad = gapi.load;
      gapi.load = function(targets, callback) {
        console.log('gapi-issue260: Watching gapi.load(', targets, ', ', callback, ').');
        if (callback instanceof Function) {
          gapiLoad(targets, () => {
            tryPatchGapi();
            callback();
          });
        } else {
          var newCallback = {
            callback: () => {
              tryPatchGapi();
              callback.callback();
            },
            onerror: callback.onerror,
          };
          gapiLoad(targets, newCallback);
        }
      };
    }
    return;
  }

  if (patchedGapiAuth2Init)
    return;
  patchedGapiAuth2Init = true;
  console.log('gapi-issue260: Patching gapi.auth2.init.');
  let gapiAuth2Init = gapi.auth2.init;
  gapi.auth2.init = function(params) {
    console.log('gapi-issue260: Watching gapi.auth2.init(', params, ').');
    return new Promise((resolve, reject) => {
      gapiAuth2Init(params).then(
          resolve,
          e => {
            if (e.error == 'idpiframe_initialization_failed') {
              console.log('gapi-issue260: Caught', e, '-- trying workaround.');
              workaround(params).then(access_token => {
                console.log('gapi-issue260: Success! Switching to gapi.auth and continuing.');
                gapi.auth.setToken({access_token});
                gapi.auth2.getAuthInstance().isSignedIn.get = () => true;
                resolve();
              });
            } else {
              reject(e);
            }
          });
    });
  };
}

function workaround(params) {
  if (document.location.hash) {
    let params = {};
    for (let piece of document.location.hash.substr(1).split('&')) {
      let [k, v] = piece.split('=', 2);
      params[decodeURIComponent(k)] = v ? decodeURIComponent(v.replace(/[+]/g, ' ')) : '';
    }
    if (params.access_token && params.expires_in) {
      localStorage.setItem('access_token_expires', Date.now() + Number(params.expires_in) * 1000);
      localStorage.setItem('access_token', params.access_token);
      let base = window.location.href;
      let i = base.indexOf('#');
      if (i > -1)
        base = base.substring(0, i);
      window.history.replaceState(null, document.title, base + (params.state ? atob(params.state) : ''));
    }
  }

  function getAuthUri() {
    let base = window.location.href;
    let state = '';
    let i = base.indexOf('#');
    if (i > -1) {
      state = base.substring(i);
      base = base.substring(0, i);
    }
    return 'https://accounts.google.com/o/oauth2/v2/auth' +
        '?client_id=' + encodeURIComponent(params.client_id) +
        '&redirect_uri=' + encodeURIComponent(base) +
        '&state=' + encodeURIComponent(btoa(state)) +
        '&response_type=token' +
        '&scope=' + encodeURIComponent(params.scope) +
        '&include_granted_scopes=true';
  }

  let access_token_expires_in = Number(localStorage.getItem('access_token_expires')) - Date.now() - 1000;
  if (access_token_expires_in < 0) {
    window.location.replace(getAuthUri());
    return Promise.reject();
  }

  window.setTimeout(() => window.location.replace(getAuthUri()), access_token_expires_in);
  return Promise.resolve(localStorage.getItem('access_token'));
}

})();
