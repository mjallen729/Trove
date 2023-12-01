// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBd-NfVvFZJqa9Rx83z67WHq0tnFar3SwY",
    authDomain: "trove-f06f2.firebaseapp.com",
    projectId: "trove-f06f2",
    storageBucket: "trove-f06f2.appspot.com",
    messagingSenderId: "473869028285",
    appId: "1:473869028285:web:0aa69e8a02c2f2acaf60d4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export modules to use
export const firestore = getFirestore(app);
export const storage = getStorage(app);