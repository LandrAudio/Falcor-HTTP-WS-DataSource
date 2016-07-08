import SocketIoClient from 'socket.io-client';
import FalcorHttpDataSource from '@synhaptein/falcor-http-datasource';
import Uuid from 'uuid';
import DelayedFunction from './delayed-function';
import Q from 'q';

var noop = () => {
};

function Observable() {
}

Observable.create = function (subscribe) {
  var o = new Observable();

  o.subscribe = function (onNext, onError, onCompleted) {
    var observer;
    var disposable;

    if (typeof onNext === 'function') {
      observer = {
        onNext: onNext,
        onError: (onError || noop),
        onCompleted: (onCompleted || noop)
      };
    } else {
      observer = onNext;
    }

    disposable = subscribe(observer);

    if (typeof disposable === 'function') {
      return {
        dispose: disposable
      };
    }

    return disposable;
  };

  return o;
};

class FalcorHttpPullWebSocketPushDataSource extends FalcorHttpDataSource {
  constructor(pullUrl, pushUrl, config = {}) {
    if (!config.headers) {
      config.headers = {};
    }

    if (!sessionStorage.tabId) {
      sessionStorage.tabId = Uuid.v4();
    }

    config.headers[config.tabIdLabel || 'X-TabId'] = sessionStorage.tabId;

    if (!config.bearerToken && config.headers['Authorization']) {
      let tokens = config.headers.Authorization.split(' ');
      config.bearerToken = tokens[1];
    }

    let socket = null;
    if (pushUrl && pushUrl.length > 0) {
      let wsUrlPath = pushUrl.match(/ws+:\/\/.*?(\/.*)/);

      if (wsUrlPath && wsUrlPath[1]) {
        config.path = wsUrlPath[1] + "/socket.io";
      }

      socket = new SocketIoClient(pushUrl, config);

      socket.emit('authorization', {bearerToken: config.bearerToken, tabId: sessionStorage.tabId});
    }

    super(pullUrl, config);

    this.socket = socket;
    this.pushEvent = "falcor-push";
    this.requestWatcher = new DelayedFunction(200); // Delay maxium between 2 falcor requests
  }

  onError() {
  }

  onRequestStart() {
  }

  onRequestStop() {
  }

  _fireRequest() {
    if (!this.requestWatcher.isRunning()) {
      this.onRequestStart();
    }
    this.requestWatcher.cancel();
  }

  _finishedRequest() {
    this.requestWatcher.run(() => {
      this.onRequestStop();
    });
  }

  _retry(method, args, observer) {
    let res;

    if (method === 'get') {
      res = super.get(...args)
    }
    else if (method === 'set') {
      res = super.set(...args)
    }
    else if (method === 'call') {
      res = super.call(...args)
    }

    res.subscribe(
      (res) => {
        // Recall the onError callback for logging purposes only
        this._needRetryOnErrors(method, args, res);
        observer.onNext(res);
      },
      (err) => {
        observer.onError(err);
      },
      () => {
        this._finishedRequest();
        observer.onCompleted();
      }
    );
  }

  _needRetryOnErrors(method, args, node) {
    let $type = node ? node.$type : null;

    if ($type === 'error') {
      return this.onError(method, args, node.value);
    }
    else if (node && typeof node === 'object') {
      let needRetries = [];

      for(var key in node) {
        needRetries.push(this._needRetryOnErrors(method, args, node[key]));
      }

      return Q.all(needRetries).then(retries => retries.reduce((r, needRetry) => r || needRetry));
    }

    return Q.fcall(() => false);
  }

  _monitorRequest(method, args, res) {
    this._fireRequest();

    let observable = Observable.create((observer) => {
      let validateNeedRetry = Q.defer();

      res.subscribe(
        (res) => {
          this._needRetryOnErrors(method, args, res).then(needRetry => {
            if (needRetry) {
              this._retry(method, args, observer);
            }
            else {
              observer.onNext(res);
            }

            validateNeedRetry.resolve(needRetry);
          });
        },
        (err) => {
          this.onError(method, args, err).then(needRetry => {
            if (needRetry) {
              this._retry(method, args, observer);
            }
            else {
              observer.onError(err);
            }

            validateNeedRetry.resolve(needRetry);
          });
        },
        () => {
          validateNeedRetry.promise.then(needRetry => {
            if (!needRetry) {
              this._finishedRequest();
              observer.onCompleted();
            }
          });
        }
      );

      return noop;
    });

    return observable;
  }

  get(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest('get', args, super.get(...args));
  }

  set(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest('set', args, super.set(...args));
  }

  call(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest('call', args, super.call(...args));
  }

  onBeforeRequest(config) {
    // as of now you're able to mutate the config object before we create our xhr instance
    // you would attach any url params here
    // config.url = config.url + '&something=Value'
    //console.log(config);
  }

  buildQueryObject(...args) {
    // helper method to build our url for advanced implementations
    return super.buildQueryObject(...args);
  }

  onPushNotifications(callback) {
    if (callback && this.socket) {
      this.socket.on(this.pushEvent, (data) => {
        callback(data);
      });
    }
  }
}

export default FalcorHttpPullWebSocketPushDataSource;
