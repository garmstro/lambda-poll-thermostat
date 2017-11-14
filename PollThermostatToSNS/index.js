'use strict';
const request = require('request');
const AWS = require('aws-sdk');
const sns = new AWS.SNS();

const USER_NAME = process.env.USER_NAME;
const encrypted = process.env.PASSWORD;
let decrypted;
const DEVICE_ID = process.env.DEVICE_ID;
const TOPIC_ARN = process.env.TOPIC_ARN;

const BASE_URL = 'https://bus-serv.sensicomfort.com';

let connection = {
  baseUrl: BASE_URL,
  authenticated: false,
  connected: false,
  deviceId: DEVICE_ID,
  timeStamp: new Date().getTime()
};

function processEvent(event, context, callback) {
  const user = {
    'UserName': USER_NAME,
    'Password': decrypted
  };

  if (connection.connected) {
    initializePolling(connection, (error, data) => {
      if (error) {
        return callback(error);
      }
      poll(connection, (error, data) => {
        sendResponse(error, parsePollData(data), callback);
      });
    });
  } else {
    authorize(user, connection, (error, data) => {
      if (error) {
        return callback(error);
      }
      negotiate(connection, (error, data) => {
        if (error) {
          return callback(error);
        }
        connect(connection, (error, data) => {
          if (error) {
            return callback(error);
          }
          initializePolling(connection, (error, data) => {
            if (error) {
              return callback(error);
            }
            poll(connection, (error, data) => {
              sendResponse(error, parsePollData(data), callback);
            });
          });
        });
      });
    });
  }
}

function sendResponse(error, data, callback) {
  if (error) {
    return callback(error);
  }
  if (!data) {
    return callback(new Error('Received no data from device!'));
  }
  return publishMessage(JSON.stringify(data), callback);
}

function publishMessage(message, callback) {
  const params = {
    Message: message,
    TopicArn: TOPIC_ARN
  }
  sns.publish(params, (error, data) => {
    if (error) {
      return callback(error);
    }
    callback(null, data);
  });
}

function authorize(user, connection, callback) {
  const params = {
    url: connection.baseUrl + '/api/authorize',
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json; version=1, */*; q=0.01',
      'Content-Type': 'application/json'
    },
    json: user
  };
  request(params, (error, response, body) => {
    if (error) {
      return callback(error);
    }
    const cookies = response.headers['set-cookie'];
    if (!cookies || cookies.length === 0) {
      return callback(new Error('Authentication failed!'));
    }
    connection.cookie = cookies[0];
    connection.authenticated = true;
    callback(null, body);
  });
}

function negotiate(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/negotiate',
    method: 'GET',
    headers: {'Cookie': connection.cookie}
  };
  request(params, (error, response, body) => {
    if (error) {
      return callback(error);
    }
    const json = JSON.parse(body);
    if (!json || !json.ConnectionToken) {
      return callback(new Error('Negotiation Failed'));
    }
    connection.token = json.ConnectionToken;    
    callback(null, body);
  });
}

function connect(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/connect',
    method: 'GET',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token,
      connectionData: '[{\"name\": \"thermostat-v1\"}]',
      tid: 4,
      _: connection.timeStamp
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      return callback(error);
    }
    const json = JSON.parse(body);
    if (!json || !json.C) {
      return callback(new Error('Connection Failed!'));
    }
    connection.messageId = json.C;    
    connection.connected = true;    
    callback(null, body);
  });
}

function initializePolling(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/send',
    method: 'POST',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token
    },
    form: {
      data: JSON.stringify({
        'H': 'thermostat-v1',
        'M': 'Subscribe',
        'A': [connection.deviceId],
        'I': 0
      })
    }
  };
  request(params, (error, response, body) => {
    if (error) {
      return callback(error);
    }
    const json = JSON.parse(body);
    if (!json) {
      return callback(new Error('Could not initialize polling!'));
    }
    if (response.statusCode === 401 || json.timedOut) {
      resetConnection();
      return callback(new Error('Connection timed out!'));
    }
    if (!json.I) {
      return callback(new Error('Unknown response to poll request!'));
    }
    callback(null, body);
  });
}

function poll(connection, callback) {
  const params = {
    url: connection.baseUrl + '/realtime/poll',
    method: 'GET',
    headers: {'Cookie': connection.cookie},
    qs: {
      transport: 'longPolling',
      connectionToken: connection.token,
      connectionData: '[{\"name\": \"thermostat-v1\"}]',
      tid: 4,
      _: connection.timeStamp,
      messageId: connection.messageId
    }
  };
  if (connection.groupsToken) {
    params.groupsToken = connection.groupsToken;
  }
  request(params, (error, response, body) => {
    if (error) {
      return callback(error);
    }
    const json = JSON.parse(body);
    if (!json) {
      return callback(new Error('Received no data from thermostat!'));
    }
    if (json.C) {
      connection.messageId = json.C;
    }
    if (json.G) {
      connection.groupsToken = json.G;
    }
    callback(null, body);
  });
}

function resetConnection() {
  connection.authenticated = false;
  connection.cookie = null;
  connection.connected = false;
  connection.connectionToken = null;
  connection.messageId = null;      
  connection.groupsToken = null;
}

function parsePollData(data) {
  let parsedData;
  const json = JSON.parse(data);
  if (json && json.M && json.M.length !== 0) {
    const mData = json.M[0];
    if (mData.A && mData.A.length > 1) {
      const thermostatId = mData.A[0];
      const thermostatData = mData.A[1];
      if (thermostatData.OperationalStatus) {
        parsedData = thermostatData.OperationalStatus;
        parsedData.Id = thermostatId;
      }                  
    }
  }
  return parsedData;
}

exports.handler = (event, context, callback) => {
  if (decrypted) {
    processEvent(event, context, callback);
  } else {
    // Decrypt code should run once and variables stored outside of the function
    // handler so that these are decrypted once per container
    const kms = new AWS.KMS();
    kms.decrypt({ CiphertextBlob: new Buffer(encrypted, 'base64') }, (err, data) => {
        if (err) {
            console.log('Decrypt error:', err);
            return callback(err);
        }
        decrypted = data.Plaintext.toString('ascii');
        processEvent(event, context, callback);
    });
  }
};