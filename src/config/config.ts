//mqtt
export const MQTT_URL = process.env.MQTT_URL || 'mqtt://mqtt.xrptipbot-api.siedentopf.xyz:4001'
export const MQTT_TOPIC_USER = process.env.MQTT_TOPIC_USER;

//tipbot api
export const TIPBOT_URL = process.env.TIPBOT_URL || 'https://www.xrptipbot.com/app/api';
export const TIPBOT_API_KEY = process.env.TIPBOT_API_KEY;

//twitter api
export const TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
export const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;
export const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
export const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
