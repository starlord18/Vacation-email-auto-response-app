const express = require('express');
const app = express();
const port = 8005;
const path = require('path');
const fs = require('fs').promises;
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const { isUtf8 } = require('buffer');
const { constants } = require('fs/promises');


const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https:/mail.google.com'
];



app.get('/', async (req, res) => {


    //Load client details from a JSON file
    const credentials = await fs.readFile('credentials.json');


    //Authorize a client with credentials, then call the Gmail API.
    const auth = await authenticate({
        keyfilePath: path.join(__dirname, 'credentials.json'),
        scopes: SCOPES,
    });

    console.log("This is AUTH = ", auth);

    
    const gmail = google.gmail({version: 'v1', auth}); 

    const response = await gmail.users.labels.list({
        userId: 'me',
    }
    );


    const LABEL_NAME = 'Vacation';

    //Load credentials from file
    async function loadCredentials() {
        const filePath = path.join(process.cwd(), 'credentials.json');
        const content = await fs.readFile(filePath, {encoding: 'utf8'});
        return JSON.parse(content);
    }


    //Get messages that have no prior replies
    async function getUnrepliedMessages(auth) {
        const gmail = google.gmail({version: 'v1', auth});
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: '-in:chats -from:me -has:userlabels',
        });
        return res.data.messages || [];
    }

    //Send reply to a message
    async function sendReply(auth, message) {
        const gmail = google.gmail({version:'v1', auth});
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From'],
        });
        const subject = res.data.payload.headers.find(
            (header) => header.name === 'Subject'
        ).value;
        const from = res.data.payload.headers.find(
            (header) => header.name === 'From'
        ).value;
        const replyTo = from.match(/<(.*)>/)[1];
        const replySubject = subject.startsWith('Re:') ? subject : `Re: $(subject)`;
        const replyBody = `Hi,\n\nI'm out on a vacation right `;
        const rawMessage = [
            `From: me`,
            `To: $(replyTo)`,
            `Subject: ${replySubject}`,
            `In-Reply-To: ${message.id}`,
            `References: ${message.id}`,
            '',
            replyBody,
        ].join('\n');
        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
    }



    async function createLabel(auth) {
        const gmail = google.gmail({version: 'v1', auth});
        try {
            const res =await gmail.users.labels.create({
                userId: 'me',
                requestBody: {
                    name: LABEL_NAME,
                    labelListVisibility: 'labelShow', //Change this value
                    messageListVisibility: 'show', //Change this value
                },
            });
            return res.data.id;
        } catch (err) {
            if(err.code === 409) {
                //Label already exists
                const res = await gmail.users.labels.list({
                    userId: 'me',
                });
                const label = res.data.labels.find((label) => label.name ===  LABEL_NAME);
                return label.id;
            }   
            else {
                throw err;
            }
        }
    }



    //Add label to a message and move it to the label folder
    async function addLabel(auth, message, labelId) {
        const gmail = google.gmail({version: 'v1', auth: auth});
        await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody: {
                addLabelids: [labelId],
                removeLabelIds: ['INBOX'],
            },
        });
    }


    //Main function
    async function main() {


        //create a label for the app
        const labelId = await createLabel(auth);
        console.log(`Created or found label with id ${labelId}`);

        //Repeat the following steps in random  intervals
        setIntervals(async () => {
            //Get messages that have no prior replies
            const messages = await getUnrepliedMessages(auth);
            console.log(`Found ${messages.length} unreplied messages`);

            //For each message
            for(const message of messages) {
                //Send reply to the message
                await sendReply(auth, message);
                console.log(`Sent reply to message with id $(message.id)`);

                //Add label to the message and move it to the label folder
                await addLabel(auth, message, labelId);
                console.log(`Added label; to message with id ${message.id}`);
            }
        }, Math.floor(Math.random() * (120 - 45 + 1) + 45)*1000); //Interval b/w 45 and 120 secs 
    }

    main().catch(console.error);




    const labels = response.data.labels;
    res.send("Label sent successfully");
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});