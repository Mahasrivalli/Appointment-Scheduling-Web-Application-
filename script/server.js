require('dotenv').config();
const express = require('express');
const app = express();
const port = 3000;
const admin = require('firebase-admin');
const { Vonage } = require('@vonage/server-sdk');
const { v4: uuidv4 } = require('uuid');
const serviceAccount = require('../serviceAccountKey.json');

//  Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE
});

const ref = admin.database().ref('/myAppointments');

//  Initialize Vonage API
const vonage = new Vonage({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.SECURITY_KEY,
});

//  Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const getDateTime = (slot) => slot.split('T');

//  Check if a slot is available
const checkIfAvailable = async (slot) => {
  let snapshot = await ref.orderByChild('date').once('value');
  let available = true;

  snapshot.forEach((data) => {
    let dataval = data.val();
    if (dataval.date === slot) available = false;
  });

  return available;
};

//  Add appointment slot to database
const addToDatabase = (slot, phonenumber) => {
  let code = uuidv4();
  ref.child(code).set({ date: slot, userId: code, phonenumber });
  return code;
};

//  Send SMS to user using Vonage
const sendSMStoUser = async (phonenumber, code, date, time) => {
  const text = `Meeting booked at ${time} on ${date}. Save this code: ${code} to cancel your appointment.`;

  try {
    const responseData = await vonage.sms.send({
      to: phonenumber,
      from: process.env.VONAGE_FROM_NUMBER,
      text: text,
    });

    console.log(" Message sent successfully:", responseData);
    return `Message sent successfully: ${responseData.messages[0].messageId}`;
  } catch (error) {
    console.error(" Message failed:", error);
    throw new Error(`Message failed: ${error.message}`);
  }
};

//  Appointment Booking Route
app.post('/appointment', async (req, res) => {
  let { phonenumber, slotdate } = req.body;
  let [date, time] = getDateTime(slotdate);

  let available = await checkIfAvailable(slotdate);
  if (!available) return res.send(` Slot ${slotdate} is already booked. Choose a different time.`);

  let code = addToDatabase(slotdate, phonenumber);
  try {
    await sendSMStoUser(phonenumber, code, date, time);
    res.send(` Slot booked successfully: ${slotdate}. Save this code: ${code} to cancel.`);
  } catch (error) {
    res.send(` Slot booked but SMS failed: ${error.message}`);
  }
});

//  Appointment Cancellation Route (Using Phone Number)
app.post('/cancelAppointment', async (req, res) => {
  let { phonenumber } = req.body;

  let snapshot = await ref.once('value');
  let found = false;

  snapshot.forEach((data) => {
    let appointment = data.val();
    if (appointment.phonenumber === phonenumber) {
      ref.child(data.key).remove();
      found = true;
      res.send(` Appointment for phone number ${phonenumber} has been canceled.`);
    }
  });

  if (!found) {
    res.send(` No appointment found for phone number ${phonenumber}.`);
  }
});

//  Start Server
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
