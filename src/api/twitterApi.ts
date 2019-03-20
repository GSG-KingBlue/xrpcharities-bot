import * as Twit from 'twit';
import * as config from '../config/config';

let additionalTweetText:string[] = [
    "Thank you for your donation!",
    "Can we have a retweet and spread the good word?",
    "What a wonderful way to start the day.",
    "Saving the world. A few XRP at a time.",
    "Good people do good things.",
    "Wow, what a great way to share some XRP!",
    "Time to make it rain!",
    "We love @xrptipbot!",
    "Giving is great, giving XRP is AMAZING!",
    "Thank you for being a Good Soul.",
    "Helping the world, one donation at a time.",
    "Your generosity is appreciated.",
    "Spreading the XRP love.",
];

let twitterClient = new Twit({
    consumer_key: config.TWITTER_CONSUMER_KEY,
    consumer_secret: config.TWITTER_CONSUMER_SECRET,
    access_token: config.TWITTER_ACCESS_TOKEN,
    access_token_secret: config.TWITTER_ACCESS_SECRET
});

export async function getCurrentFollowers(): Promise<any> {
    return twitterClient.get('friends/list');
}

export async function sendOutTweet(message: string, greetingText: string) {
    console.log("Sending out new tweet: \n" + message+greetingText);
    try {
        await twitterClient.post('statuses/update', {status: message+greetingText});
    } catch(err) {
        console.log("Could not send out tweet! Trying again.")
        if(err && err.code) {
            try {
                if(err.code == 186) {
                    //tweet to long. try to send tweet without any greeting!
                    await twitterClient.post('statuses/update', {status: message});
                } else if(err.code==187) {
                    //duplicate tweet exception, try another greetings text
                    greetingText = '\n'+getRandomGreetingsText() + '#XRPforGood #XRPCommunity #XRP';
                    console.log("sending out modified message:\n" + message+greetingText);
                    
                        await twitterClient.post('statuses/update', {status: message+greetingText});
                }
            } catch(err) {
                //give up sending any more tweets if it failed again!
                console.log("sending out tweet failed again. giving up.")
                console.log(JSON.stringify(err));
            }
        }
    }
}

export function getRandomGreetingsText(): string {
    //return a random text, the range is the length of the text array
    return additionalTweetText[Math.floor(Math.random() * additionalTweetText.length)];
}