import * as Twit from 'twit';
import * as config from '../config/config';

let twitterClient = new Twit({
    consumer_key: config.TWITTER_CONSUMER_KEY,
    consumer_secret: config.TWITTER_CONSUMER_SECRET,
    access_token: config.TWITTER_ACCESS_TOKEN,
    access_token_secret: config.TWITTER_ACCESS_SECRET
});

export async function getCurrentFollowers(): Promise<any> {
    return twitterClient.get('friends/list');
}

export async function sendOutTweet(message: string) {
    return twitterClient.post('statuses/update', {status: message});
}