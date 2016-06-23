import SocketIoClient from 'socket.io-client';
import FalcorHttpDataSource from 'falcor-http-datasource';
import Uuid from 'uuid';
import DelayedFunction from './delayed-function';

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
    let wsUrlPath = pushUrl.match(/ws+:\/\/.*?(\/.*)/);

    if (wsUrlPath[1]) {
      config.path = wsUrlPath[1] + "/socket.io";
    }

    let socket = new SocketIoClient(pushUrl, config);

    if (!config.headers) {
      config.headers = {};
    }

    if (!sessionStorage.tabId) {
      sessionStorage.tabId = Uuid.v4();
    }

    config.headers[config.tabIdLabel || 'X-TabId'] = sessionStorage.tabId;

    if (config.bearerToken) {
      config.headers.Authorization = 'Bearer ' + config.bearerToken;
    }

    socket.emit('authorization', {bearerToken: config.bearerToken, tabId: sessionStorage.tabId});

    super(pullUrl, config);

    this.pushEvent = "falcor-push";
    this.socket = socket;
    this.requestWatcher = new DelayedFunction(200); // Delay maxium between 2 falcor requests
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
  };

  _finishedRequest() {
    this.requestWatcher.run(() => {
      this.onRequestStop();
    });
  };

  _monitorRequest(res) {
    this._fireRequest();

    let observable = Observable.create((observer) => {
      res.subscribe(
        (res) => observer.onNext(res),
        (err) => {
          console.log("DataSource Error");
          console.log(err);
          observer.onError(err)
        },
        () => {
          this._finishedRequest();
          observer.onCompleted();
        }
      );

      return noop;
    });

    return observable;
  }

  get(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest(super.get(...args));
  }

  set(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest(super.set(...args));
  }

  call(...args) {
    // returns an Observable if you wanted to map/filter/reduce/etc
    return this._monitorRequest(super.call(...args));
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
    if (callback) {
      this.socket.on(this.pushEvent, (data) => {
        callback(data);
      });
    }
  }
}

export default FalcorHttpPullWebSocketPushDataSource;
