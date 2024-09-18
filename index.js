// This example uses Express to receive webhooks
const express = require('express');
const app = express();
const dotenv = require('dotenv')
const firebaseAdmin = require("firebase-admin");

const serviceAccount = require("./firebase_configuration_goes_here.json");
const {getFirestore} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
dotenv.config();

const firebaseApp = firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert(serviceAccount)
});

const auth = getAuth(firebaseApp);
const fireStore = getFirestore(app);


const createAuthUser = async (customerSession) => {
    try {
        await auth.createUser({
            email: customerSession.email,
            emailVerified: false,
            password: 'password',
            displayName: customerSession.name ? customerSession.name : "",
        })

    } catch (e) {
        const user = await auth.getUserByEmail(customerSession.email);
        await auth.updateUser(user.uid, {
            emailVerified: true,
            displayName: customerSession.name ? customerSession.name : "",

        })
    }


}

// Match the raw body to content type application/json
// If you are using Express v4 - v4.16 you need to use body-parser, not express, to retrieve the request body
app.post('/', express.json({type: 'application/json'}), async (request, response) => {
        const event = request.body;

        console.log(event)


        switch (event.type) {

            case 'customer.updated':
            case 'customer.created':
                const customerSession = event.data.object;

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
                                firebaseRole: 'premium'
                            })
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
                        } catch (e) {
                            console.error(e);
                        }

                        break;
                }


                // Update the checkout session with the document id
                if (checkOutSession.customer) {
                    const tempuser = await auth.getUserByEmail(checkOutSession.customer_details.email);
                    const refStore = await fireStore.collection('customers')
                        .doc(tempuser.uid);
                    const doc = await refStore.get();
                    if (!doc.exists) {
                        const user = await auth.getUserByEmail(checkOutSession.customer_details.email);
                        await refStore.create({
                            id: user.uid,
                            stripeId: checkOutSession.customer,
                            email: checkOutSession.customer_details.email,
                            name: "",
                            metadata: {
                                ...checkOutSession.metadata,
                                'firebaseRole': checkOutSession.payment_status === 'paid' ? 'premium' : 'basic'
                            }
                        })
                    } else {
                        await refStore.update({
                            metadata: {
                                ...checkOutSession.metadata,
                                'firebaseRole': checkOutSession.payment_status === 'paid' ? 'premium' : 'basic'
                            }
                        })
                    }
                    const user = await auth.getUserByEmail(checkOutSession.customer_details.email);
                    await fireStore
                        .collection('customers')
                        .doc(user.uid)
                        .collection("checkout_sessions")
                        .add({
                            mode: "payment",
                            price: checkOutSession.amount_total,
                            success_url: checkOutSession.success_url,
                            cancel_url: checkOutSession.cancel_url,
                            status: checkOutSession.payment_status,
                        });


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
                    console.log(subscriptionDoc);
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
)
;

app.listen(process.env.PORT, () => console.log(`Running on port ${process.env.PORT}`));
