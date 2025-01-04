// The following code is an example of a webhook endpoint that listens for Stripe events.
const express = require('express');
const app = express();
const dotenv = require('dotenv')
const firebaseAdmin = require("firebase-admin");

const serviceAccount = require("./firebase-admin.json");
const {getFirestore} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
dotenv.config();

// SUBSCRIPTION CONSTANT

const Subscription = {
    BASIC: 'basic',
    PREMIUM: 'premium'
}

const firebaseApp = firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount)
});

const auth = getAuth(firebaseApp);
const fireStore = getFirestore(app);


const createCustomer = async (customerSession) => {
    const user = await auth.getUserByEmail(customerSession.customer_details.email);

    // Set the name

    if(customerSession.customer_details.name ){
        await auth.updateUser(user.uid, {
            displayName: customerSession.customer_details.name
        });
    }
    const customerRef = fireStore
        .collection('customers')
        .doc(user.uid)

    const doc = await customerRef.get();
    if (!doc.exists) {
        // exists in Firebase Authentication
        try {
            await customerRef.create({
                id: user.uid,
                stripeId: customerSession.id,
                email: user.email,
                name: customerSession.customer_details.name,
                phone: customerSession.customer_details.phone ? customerSession.customer_details.phone : "",
                metadata: {
                    ...customerSession.metadata,
                    'firebaseRole': customerSession.payment_status === 'paid' ? Subscription.PREMIUM : Subscription.BASIC
                }
            });
        } catch (e) {
            console.error(e);
        }
        finally {
            await fireStore
                .collection('customers')
                .doc(user.uid)
                .collection("checkout_sessions")
                .add({
                    mode: "payment",
                    price: customerSession.amount_total,
                    success_url: customerSession.success_url,
                    cancel_url: customerSession.cancel_url,
                    status: customerSession.payment_status === 'paid' ? Subscription.PREMIUM : Subscription.BASIC,
                });
        }
    }
}



// Match the raw body to content type application/json
// If you are using Express v4 - v4.16 you need to use body-parser, not express, to retrieve the request body
app.post('/webhook', express.json({type: 'application/json'}), async (request, response) => {
        const event = request.body;

        console.log(event)


        switch (event.type) {

            case 'customer.updated':
            case 'customer.created':
                const customerSession = event.data.object;
                if(customerSession.email === null){
                    throw new Error('Stripe Email is required to create a user');
                }

                const user = await auth.getUserByEmail(customerSession.email);
                const customerRef = fireStore
                    .collection('customers')
                    .doc(user.uid)


                const doc = await customerRef.get();
                if (!doc.exists) {
                    // exists in Firebase Authentication
                    const user = await auth.getUserByEmail(customerSession.email);
                    try {
                        await customerRef.create({
                            id: user.uid,
                            stripeId: customerSession.id,
                            email: customerSession.email,
                            name: customerSession.name,
                            phone: customerSession.phone ? customerSession.phone : "",
                            metadata: {
                                ...customerSession.metadata,
                                'firebaseRole': 'basic'
                            }
                        });
                    } catch (e) {
                        console.error(e);
                    }


                }

                break;

            case   'checkout.session.completed':

                const checkOutSession = event.data.object;

                switch (checkOutSession.payment_status) {

                    case 'paid':
                        try {
                            const user = await auth.getUserByEmail(checkOutSession.customer_details.email);
                            await auth.setCustomUserClaims(user.uid, {
                                firebaseRole: Subscription.PREMIUM
                            })
                            await createCustomer(checkOutSession);
                        } catch (e) {
                            console.error(e);
                        }

                        break;

                    case 'unpaid':
                        try {
                            const user = await auth.getUserByEmail(checkOutSession.customer_details.email);
                            await auth.setCustomUserClaims(user.uid, {
                                firebaseRole: 'basic'
                            });
                            await createCustomer(checkOutSession);
                        } catch (e) {
                            console.error(e);
                        }

                        break;
                }

                break;

            // handle subscription created and cancelled events
            case 'customer.subscription.created':
            case 'customer.subscription.deleted':
                let userUID = null;
                const subscription = event.data.object;
                if (subscription.status !== 'incomplete') {

                    const subscriptionDoc = await fireStore
                        .collection('customers')
                        .where('stripeId', '==', subscription.customer)
                        .limit(1).get();

                    if (!subscriptionDoc.empty) {
                        subscriptionDoc.forEach(doc => {
                            userUID = doc.id;
                            if (event.type === 'customer.subscription.created') {
                                fireStore.collection('customers')
                                    .doc(userUID).collection('subscriptions')
                                    .doc(subscription.id).create({
                                    ...subscription
                                }).then()

                            }

                            if(event.type === 'customer.subscription.deleted'){
                                fireStore.collection('customers').doc(userUID).update({
                                    metadata: {
                                        ...subscription.metadata,
                                        'firebaseRole': 'basic'
                                    }
                                })
                                fireStore.collection('customers')
                                    .doc(userUID).collection('subscriptions')
                                    .doc(subscription.id).delete().then()
                            }
                        });
                    }
                }


                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }

// Return a response to acknowledge receipt of the event
        response.json({received: true});
    }
);

const port = process.env.PORT || 9000;
app.listen(port, () => console.log(`Running on port ${port}`));
