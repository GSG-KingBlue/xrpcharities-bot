//general
export const DROPS = 1000000;

//mqtt
export const MQTT_URL = process.env.MQTT_URL || 'mqtt://mqtt.xrptipbot-api.siedentopf.xyz:4001'
export const MQTT_TOPIC_USER = process.env.MQTT_TOPIC_USER;

//tipbot feed api
export const TIPBOT_FEED_API = process.env.TIPBOT_API || 'https://xrptipbot-api.siedentopf.xyz/std-feed'

//tipbot api
export const TIPBOT_URL = process.env.TIPBOT_URL || 'https://www.xrptipbot.com/app/api';
export const TIPBOT_API_KEY = process.env.TIPBOT_API_KEY;
export const MAX_XRP_VIA_TIP:number = parseInt(process.env.MAX_XRP_VIA_TIP) || 500;

//twitter api real
export const TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
export const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;
export const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
export const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

//twitter api bots
export const TWITTER_CONSUMER_KEY_BOTS = process.env.TWITTER_CONSUMER_KEY_BOTS;
export const TWITTER_CONSUMER_SECRET_BOTS = process.env.TWITTER_CONSUMER_SECRET_BOTS;
export const TWITTER_ACCESS_TOKEN_BOTS = process.env.TWITTER_ACCESS_TOKEN_BOTS;
export const TWITTER_ACCESS_SECRET_BOTS = process.env.TWITTER_ACCESS_SECRET_BOTS;
