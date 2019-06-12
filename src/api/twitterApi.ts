import * as Twit from 'twit';
import * as shuffle from 'shuffle-array';
import * as util from '../util';

import consoleStamp = require("console-stamp");
consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

const nodePersist = require('node-persist');

interface tweetMessage {
    message:string,
    greeting:string
}

export class TwitterApi {

    additionalTweetText:string[] = [
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
        "Many small drops together make an ocean!",
        "Your $XRP will make a difference!",
        "Small acts of kindness can change the world.",
        "Every XRP counts!",
        "Thank you for spreading good vibes!",
        "Your generosity is compassion in action!",
        "Kind gestures make this world a better place!",
        "Generosity is a great growth stratergy :)",
        "What a great way to make this world a happier place!",
        "Giving does as much good for the soul as receiving.",
        "Giving is the greatest joy.",
        "Giving XRP just makes it even sweeter.",
        "Kindness will never go unrewarded.",
        "The secret to a happy life is giving.",
        "We rise by lifting others!",
        "The xrptipbot is world changing!",
        "You are part of the micro-donation revolution!"
    ];

    additionalHashtags:string[] = [
        "#XRPforGood",
        "#XRPCommunity",
        "#XRP"
    ];

    consumer_key:string;
    consumer_secret:string;
    access_token:string;
    access_token_secret:string;

    tweetWindow:number = 15*60*1000; //16 minutes

    tweetQueue:tweetMessage[] = [];
    lastWindowStart:number = 0;
    maxNumberOfRequestsRemaining = 0;
    isProcessingTweet = false;

    twitterClient:Twit;
    storageName:string;
    storage:any;

    constructor(consumer_key:string, consumer_secret:string, access_token:string, access_token_secret:string, storageName:string) {
        this.consumer_key = consumer_key;
        this.consumer_secret = consumer_secret;
        this.access_token = access_token;
        this.access_token_secret = access_token_secret;
        this.storageName = storageName;
    }

    async initTwitter() {
        this.twitterClient = new Twit({
            consumer_key: this.consumer_key,
            consumer_secret: this.consumer_secret,
            access_token: this.access_token_secret,
            access_token_secret: this.storageName
        });

        try {
            this.storage = nodePersist.create({dir: 'storage/'+this.storageName});
            await this.storage.init();


            //check if we have a queue
            if(await this.storage.getItem('tweetQueue'))
                this.tweetQueue = await this.storage.getItem('tweetQueue');

            if(await this.storage.getItem('lastWindowStart'))
                this.lastWindowStart = await this.storage.getItem('lastWindowStart');

            if(await this.storage.getItem('maxNumberOfRequestsRemaining'))
                this.maxNumberOfRequestsRemaining = await this.storage.getItem('maxNumberOfRequestsRemaining');
        } catch(err) {
            this.writeToConsole(JSON.stringify(err));
        }

        this.writeToConsole("loaded tweetQueue with: " + JSON.stringify(this.tweetQueue.length) + " tweets.");
        this.writeToConsole("loaded lastWindowStart: " + this.lastWindowStart);
        this.writeToConsole("loaded maxNumberOfRequestsRemaining: " + this.maxNumberOfRequestsRemaining);

        //set interval timer to empty queue every 30 seconds
        setInterval(async () => this.emptyQueue(), 30000);
    }

    async getCurrentFollowers(): Promise<any> {
        return this.twitterClient.get('friends/list');
    }

    async emptyQueue(): Promise<void> {
        
        //check if we can set a new start window
        if(!this.isProcessingTweet && this.tweetQueue.length > 0 && ((this.lastWindowStart+this.tweetWindow) < Date.now())) {
            //start a new
            try {
                await this.setNewWindow();
            } catch(err) {
                this.writeToConsole(JSON.stringify(err));
            }
        }

        //if we are already processing a tweet or we don´t have any tweets -> skip
        if(!this.isProcessingTweet && this.maxNumberOfRequestsRemaining > 0 && this.tweetQueue.length > 0) {
            this.isProcessingTweet = true;

            this.writeToConsole("maxNumberOfRequestsRemaining: " + this.maxNumberOfRequestsRemaining)
            this.writeToConsole("tweetQueue: " + this.tweetQueue.length)
            
            let newTweet:tweetMessage = this.tweetQueue[0];
            this.writeToConsole("Sending out new tweet with " + this.maxNumberOfRequestsRemaining + " requests remaining.");
            try {
                this.maxNumberOfRequestsRemaining--;
                await this.storage.setItem('maxNumberOfRequestsRemaining',this.maxNumberOfRequestsRemaining);
                await this.twitterClient.post('statuses/update', {status: newTweet.message+newTweet.greeting});
                this.writeToConsole("tweet sent out!");

                //always set latest tweet queue to this.storage in case the program/server crashes. So it can be restored on startup
                this.tweetQueue = this.tweetQueue.slice(1);
                await this.storage.setItem('tweetQueue',this.tweetQueue);
            } catch(err) {
                this.writeToConsole(JSON.stringify(err));
                this.writeToConsole("Could not send out tweet! Trying again.")
                if(err && err.code) {
                    try {
                        if(err.code == 186) {
                            //tweet to long. try to send tweet without any greeting!
                            if(this.maxNumberOfRequestsRemaining > 0) {
                                this.maxNumberOfRequestsRemaining--;
                                await this.storage.setItem('maxNumberOfRequestsRemaining',this.maxNumberOfRequestsRemaining);
                                await this.twitterClient.post('statuses/update', {status: newTweet.message});
                                this.writeToConsole("tweet sent out!");

                                this.tweetQueue = this.tweetQueue.slice(1);
                                await this.storage.setItem('tweetQueue',this.tweetQueue);
                            }

                        } else if(err.code == 187) {
                            //duplicate tweet exception, try another greetings text
                            let greetingText = '\n'+this.getRandomGreetingsText() + '\n' + this.getRandomHashtagText();
                            this.writeToConsole("sending out modified message: " + newTweet.message+greetingText);

                            if(this.maxNumberOfRequestsRemaining > 0) {
                                this.maxNumberOfRequestsRemaining--;
                                await this.storage.setItem('maxNumberOfRequestsRemaining',this.maxNumberOfRequestsRemaining);
                                await this.twitterClient.post('statuses/update', {status:newTweet. message+greetingText});
                                this.writeToConsole("tweet sent out!");

                                this.tweetQueue = this.tweetQueue.slice(1);
                                await this.storage.setItem('tweetQueue',this.tweetQueue);
                            }
                        } else {
                            await this.handleFailedTweet();
                        }
                    } catch(err) {
                        this.writeToConsole(JSON.stringify(err));
                        try {
                            await this.handleFailedTweet();
                        } catch(err) {
                            this.writeToConsole(JSON.stringify(err));
                        }
                    }
                } else {
                    try {
                        await this.handleFailedTweet();
                    } catch(err) {
                        this.writeToConsole(JSON.stringify(err));
                    }
                }
            }
            
            //push out message that no tweets can be sent out anymore. waiting for next window to open
            if(this.maxNumberOfRequestsRemaining==0)
                this.writeToConsole("Reached max number of tweets within 15 minutes. Waiting for next tweet window to open.")
                
            this.isProcessingTweet = false;
        }
    }

    async handleFailedTweet(): Promise<any> {
        //give up sending any more tweets if it failed again!
        this.writeToConsole("sending out tweet failed again. giving up.")
        this.tweetQueue = this.tweetQueue.slice(1);
        try {
            return this.storage.setItem('tweetQueue',this.tweetQueue);
        } catch(err) {
            this.writeToConsole(JSON.stringify(err));
        }
    }

    async pushToQueue(message:string, greeting:string) {
        this.writeToConsole("pusing new tweet to queue:");
        this.tweetQueue.push({message: message, greeting: greeting});
        try {
            await this.storage.setItem('tweetQueue', this.tweetQueue);
        } catch(err) {
            this.writeToConsole(JSON.stringify(err));
        }
        this.writeToConsole("tweetQueue contains now " + this.tweetQueue.length + " elements.");
    }

    async setNewWindow(): Promise<any> {
        this.writeToConsole("Resetting window")
        //reset start time
        this.lastWindowStart = Date.now();
        try {
            await this.storage.setItem('lastWindowStart',this.lastWindowStart);
        } catch(err) {
            this.writeToConsole(JSON.stringify(err));
        }
        //reset number of possible tweets
        this.maxNumberOfRequestsRemaining = 15;
        return this.storage.setItem('maxNumberOfRequestsRemaining',this.maxNumberOfRequestsRemaining);
    }

    getRandomGreetingsText(): string {
        //return a random text, the range is the length of the text array
        return this.additionalTweetText[Math.floor(Math.random() * this.additionalTweetText.length)];
    }

    getRandomHashtagText(): string {
        //shuffle hashtags so we get a differnet tweet to avoid duplicate tweet exception
        let shuffledHashtags = shuffle(this.additionalHashtags, { 'copy': true });
        let hashtags = "";
        for(let i = 0; i<shuffledHashtags.length;i++)
            hashtags+=shuffledHashtags[i] + " ";
        
        return hashtags.trim();
    }

    writeToConsole(message:string) {
        util.writeConsoleLog('[TWITTER] ', message);
    }
}