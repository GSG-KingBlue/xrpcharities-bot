import * as Twit from 'twit';
import * as shuffle from 'shuffle-array';
import * as config from '../config/config';

let latestMentionId:string = "0";

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
]

let twitterClient = new Twit({
    consumer_key: config.TWITTER_CONSUMER_KEY,
    consumer_secret: config.TWITTER_CONSUMER_SECRET,
    access_token: config.TWITTER_ACCESS_TOKEN,
    access_token_secret: config.TWITTER_ACCESS_SECRET
});

export async function getCurrentFollowers(): Promise<any> {
    return twitterClient.get('friends/list');
}

export async function sendOutNormalTweet(message: string, greetingText: string): Promise<any> {
    console.log("Sending out new tweet: \n" + message+greetingText);
    try {
        await twitterClient.post('statuses/update', {status: message+greetingText});
    } catch(err) {
        console.log(JSON.stringify(err));
        console.log("Could not send out tweet! Trying again.")
        if(err && err.code) {
            try {
                if(err.code == 186) {
                    //tweet to long. try to send tweet without any greeting!
                    await twitterClient.post('statuses/update', {status: message});
                } else if(err.code == 187) {
                    //duplicate tweet exception, try another greetings text
                    greetingText = '\n'+getRandomGreetingsText() + '\n' + getRandomHashtagText();
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

export async function sendOutWithLinkedTweet(tweetId:string, message: string, greetingText: string) {
    console.log("Sending out retweet: \n" + message+greetingText);
    try {
        await twitterClient.post('statuses/retweet/'+tweetId, {status: message+greetingText});
    } catch(err) {
    }
}

export async function checkForRetweetMatch(user: string, xrp: number): Promise<string> {
    try {
        let latestMentions = await getMentions();
        console.log("checking mentions: " + latestMentions.length);
        for(let i = 0; i < latestMentions.length;i++) {
            console.log(JSON.stringify(latestMentions[i]));
            if(latestMentions[i].text.contains(user)
                && latestMentions[i].text.contains(xrp+'')) {
                //seems we have a match -> return tweet id string to retweet
                latestMentionId = latestMentions[i].id_str;
                return latestMentions[i].id_str;
            }
        }

        return null;
    } catch(err) {
        console.log("Err Mentions: " + JSON.stringify(err));
        return null;
    }
}

export async function getMentions() : Promise<any[]> {
    console.log("Getting latest mentions");
    try {
        let mentions:any = await twitterClient.get('statuses/mentions_timeline');
        
        if(mentions && mentions.data)
            return mentions.data;
        else
            return [];
    } catch(err) {
        console.log("couldn`t get latest mentions");
        console.log(JSON.stringify(err));
        return [];
    }
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