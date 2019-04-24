import * as Twit from 'twit';
import * as shuffle from 'shuffle-array';
import * as config from '../config/config';
import * as storage from 'node-persist';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'dd-MM-yyyy HH:MM:ss' });

let additionalTweetText:string[] = [
    "Thank you for your donation!",
    "Can we have a retweet and spread the good word?",
    "What a wonderful way to start the day.",
    "Saving the world. A few $XRP at a time.",
    "Good people do good things.",
    "Wow, what a great way to share some $XRP!",
    "Time to make it rain!",
    "We love the xrptipbot!",
    "Giving is great, giving $XRP is AMAZING!",
    "Thank you for being a Good Soul.",
    "Helping the world, one donation at a time.",
    "Your generosity is appreciated.",
    "Spreading the $XRP love.",
];

let additionalHashtags:string[] = [
    "#XRPforGood",
    "#XRPCommunity",
    "#XRP"
];

interface tweetMessage {
    message:string,
    greeting:string
}

let tweetWindow:number = 15*60*1000; //16 minutes

let tweetQueue:tweetMessage[] = [];
let lastWindowStart:number = 0;
let maxNumberOfRequestsRemaining = 15;
let isProcessingTweet = false;

let twitterClient = new Twit({
    consumer_key: config.TWITTER_CONSUMER_KEY,
    consumer_secret: config.TWITTER_CONSUMER_SECRET,
    access_token: config.TWITTER_ACCESS_TOKEN,
    access_token_secret: config.TWITTER_ACCESS_SECRET
});

export async function initStorageAndInterval() {
    await storage.init({dir: 'storage'});

    //check if we have a queue
    if(await storage.getItem('tweetQueue'))
        tweetQueue = await storage.getItem('tweetQueue');

    if(await storage.getItem('lastWindowStart'))
        lastWindowStart = await storage.getItem('lastWindowStart');

    if(await storage.getItem('maxNumberOfRequestsRemaining'))
        maxNumberOfRequestsRemaining = await storage.getItem('maxNumberOfRequestsRemaining');

    console.log("loaded tweetQueue: " + JSON.stringify(tweetQueue));
    console.log("loaded lastWindowStart: " + lastWindowStart);
    console.log("loaded maxNumberOfRequestsRemaining: " + maxNumberOfRequestsRemaining);

    //set interval timer to empty queue every 10 seconds
    setInterval(async () => await emptyQueue(), 30000);
}

export async function getCurrentFollowers(): Promise<any> {
    return twitterClient.get('friends/list');
}

export async function emptyQueue(): Promise<void> {
    
    if(!isProcessingTweet && maxNumberOfRequestsRemaining > 0 && tweetQueue.length > 0) {
        isProcessingTweet = true;

        if(lastWindowStart+tweetWindow < Date.now()) {
            //start a new
            setNewWindow();
        }

        console.log("maxNumberOfRequestsRemaining: " + maxNumberOfRequestsRemaining)
        console.log("tweetQueue: " + tweetQueue.length)
        
        let newTweet:tweetMessage = tweetQueue[0];
        console.log("Sending out new tweet: " + newTweet.message+newTweet.greeting + " with " + maxNumberOfRequestsRemaining + " requests remaining.");
        try {
            maxNumberOfRequestsRemaining--;
            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
            await twitterClient.post('statuses/update', {status: newTweet.message+newTweet.greeting});
            console.log("tweet sent out!");

            tweetQueue = tweetQueue.slice(1);
            await storage.setItem('tweetQueue',tweetQueue);
        } catch(err) {
            console.log(JSON.stringify(err));
            console.log("Could not send out tweet! Trying again.")
            if(err && err.code) {
                try {
                    if(err.code == 186) {
                        //tweet to long. try to send tweet without any greeting!
                        if(maxNumberOfRequestsRemaining > 0) {
                            maxNumberOfRequestsRemaining--;
                            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
                            await twitterClient.post('statuses/update', {status: newTweet.message});
                            console.log("tweet sent out!");

                            tweetQueue = tweetQueue.slice(1);
                            await storage.setItem('tweetQueue',tweetQueue);
                        }

                    } else if(err.code == 187) {
                        //duplicate tweet exception, try another greetings text
                        let greetingText = '\n'+getRandomGreetingsText() + '\n' + getRandomHashtagText();
                        console.log("sending out modified message: " + newTweet.message+greetingText);

                        if(maxNumberOfRequestsRemaining > 0) {
                            maxNumberOfRequestsRemaining--;
                            await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
                            await twitterClient.post('statuses/update', {status:newTweet. message+greetingText});
                            console.log("tweet sent out!");

                            tweetQueue = tweetQueue.slice(1);
                            await storage.setItem('tweetQueue',tweetQueue);
                        }
                    }
                } catch(err) {
                    //give up sending any more tweets if it failed again!
                    console.log("sending out tweet failed again. giving up.")
                    console.log(JSON.stringify(err));
                    tweetQueue = tweetQueue.slice(1);
                    await storage.setItem('tweetQueue',tweetQueue);
                }
            }
        }
        
        isProcessingTweet = false;
    }
}

export async function pushToQueue(message:string, greeting:string) {
    console.log("pusing to queue: " + message)
    tweetQueue.push({message: message, greeting: greeting});
    await storage.setItem('tweetQueue', tweetQueue);
    console.log("queue contains now " + tweetQueue.length + " elements.");
}

async function setNewWindow() {
    console.log("Resetting window")
    //reset start time
    lastWindowStart = Date.now();
    await storage.setItem('lastWindowStart',lastWindowStart);
    //reset number of possible tweets
    maxNumberOfRequestsRemaining = 15;
    await storage.setItem('maxNumberOfRequestsRemaining',maxNumberOfRequestsRemaining);
}

export function getRandomGreetingsText(): string {
    //return a random text, the range is the length of the text array
    return additionalTweetText[Math.floor(Math.random() * additionalTweetText.length)];
}

export function getRandomHashtagText(): string {
    let shuffledHashtags = shuffle(additionalHashtags, { 'copy': true });
    let hashtags = "";
    for(let i = 0; i<shuffledHashtags.length;i++)
        hashtags+=shuffledHashtags[i] + " ";
    
    return hashtags.trim();
}