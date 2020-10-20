var settings = {
    mqtt: {
        host: process.env.MQTT_HOST || 'tcp://127.0.0.1:1883',
        user: process.env.MQTT_USER || '',
        password: process.env.MQTT_PASS || '',
        clientId: process.env.MQTT_CLIENT_ID || null
    },
    keepalive: {
        topic: process.env.KEEP_ALIVE_TOPIC || 'keep_alive',
        message: process.env.KEEP_ALIVE_MESSAGE || 'keep_alive'
    },
    debug: process.env.DEBUG_MODE || false,
    auth_key: process.env.AUTH_KEY || '',
    http_port: process.env.PORT || 8082
};

var mqtt = require('mqtt');
var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer');

var app = express();

function getMqttClient() {

    var options = {
        username: settings.mqtt.user,
        password: settings.mqtt.password
    };

    if (settings.mqtt.clientId) {
        options.clientId = settings.mqtt.clientId;
    }

    return mqtt.connect(settings.mqtt.host, options);
}

var mqttClient = getMqttClient();

app.set('port', settings.http_port);
app.use(bodyParser.json());

function logRequest(req, res, next) {
    var ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    var message = 'Received request [' + req.originalUrl +
        '] from [' + ip + ']';

    if (settings.debug) {
        message += ' with payload [' + JSON.stringify(req.body) + ']';
    } else {
        message += '.';
    }
    console.log(message);

    next();
}

function authorizeUser(req, res, next) {
    if (settings.auth_key && req.body['key'] != settings.auth_key) {
        console.log('Request is not authorized.');
        res.sendStatus(401);
    }
    else {
        next();
    }
}

function checkSingleFileUpload(req, res, next) {
    if (req.query.single) {
        var upload = multer().single(req.query.single);

        upload(req, res, next);
    }
    else {
        next();
    }
}

function checkMessagePathQueryParameter(req, res, next) {
    if (req.query.path) {
        req.body.message = req.body[req.query.path];
    }
    next();
}

function checkTopicQueryParameter(req, res, next) {

    if (req.query.topic) {
        req.body.topic = req.query.topic;
    }

    next();
}

function ensureTopicSpecified(req, res, next) {
    if (!req.body.topic) {
        res.status(500).send('Topic not specified');
    }
    else {
        next();
    }
}

app.get('/keep_alive/', logRequest, function (req, res) {
    mqttClient.publish(settings.keepalive.topic, settings.keepalive.message);
    res.sendStatus(200);
});

app.post('/post/', logRequest, authorizeUser, checkSingleFileUpload, checkMessagePathQueryParameter, checkTopicQueryParameter, ensureTopicSpecified, function (req, res) {
    mqttClient.publish(req.body['topic'], req.body['message']);
    res.sendStatus(200);
});

app.get('/subscribe/', logRequest, authorizeUser, function (req, res) {

    var topic = req.query.topic;

    if (!topic) {
        res.status(500).send('topic not specified');
    }
    else {
        // get a new mqttClient
        // so we dont constantly add listeners on the 'global' mqttClient
        var mqttClient = getMqttClient();

        mqttClient.on('connect', function () {
            mqttClient.subscribe(topic);
        });

        mqttClient.on('message', function (t, m) {
            if (t === topic) {
                res.write(m);
            }
        });

        req.on("close", function () {
            mqttClient.end();
        });

        req.on("end", function () {
            mqttClient.end();
        });
    }
});

app.post('/api/v1/webhooks/calendar/onEventStart', function (req, res) {
    if (!!req.body.event) {
        var startTime = Date.parse(req.body.event.startTime);
        var endTime = Date.parse(req.body.event.endTime);
        var nowSeconds = new Date().getUTCSeconds();
        var timeout = endTime.getUTCSeconds() - nowSeconds - 120;

        if (Math.abs(nowSeconds - startTime.getUTCSeconds()) <= 120 && timeout > 0) {
            mqttClient.publish('ay/calendar/events/current', JSON.stringify(req.body.event), {qos: 1, retain: true});

            mqttClient.publish('ay/calendar/events/current/id', String(req.body.event.id), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/link', String(req.body.event.link), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/title', String(req.body.event.title), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/status', String(req.body.event.status), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/location', String(req.body.event.location), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/startTime', String(req.body.event.startTime), {qos: 1, retain: true});
            mqttClient.publish('ay/calendar/events/current/endTime', String(req.body.event.endTime), {qos: 1, retain: true});

            setTimeout(() => {
                mqttClient.publish('ay/calendar/events/current', '', {qos: 1, retain: true});

                mqttClient.publish('ay/calendar/events/current/id', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/link', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/title', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/status', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/location', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/startTime', '', {qos: 1, retain: true});
                mqttClient.publish('ay/calendar/events/current/endTime', '', {qos: 1, retain: true});
            }, timeout * 1000);
        }

        res.status(200).send();
    }
    else {
        res.status(400).send('Bad Request');
    }
});

app.listen(app.get('port'), '0.0.0.0', function () {
    console.log('Node app is running on port', app.get('port'));
});
