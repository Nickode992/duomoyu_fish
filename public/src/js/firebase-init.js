// Firebase config is not private so I don't mind having it in a public repository
const firebaseConfig = {
  apiKey: "AIzaSyB0SvfVvI8Eq1ZUhzCgJHRqJKKhanWABTI",
  authDomain: "checkboxgame.firebaseapp.com",
  projectId: "checkboxgame",
  storageBucket: "checkboxgame.firebasestorage.app",
  messagingSenderId: "571679687712",
  appId: "1:571679687712:web:68f1a057e0592d1739e845"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();

// Enable persistent local cache for offline support and reduced read costs
// This caches data locally in IndexedDB to reduce Firestore reads
window.db.enablePersistence({
  synchronizeTabs: true  // Allow multiple tabs to share the same cache
}).then(() => {
  console.log('Firestore persistence enabled - this will reduce read costs');
}).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence failed: Multiple tabs open, only one tab can enable persistence');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence failed: Browser does not support persistence');
  } else {
    console.error('Persistence failed:', err);
  }
});
