// src/firebase.js
// ⚠️  Reemplazá estos valores con los de TU proyecto Firebase
// (los encontrás en Firebase Console → Configuración del proyecto → Tu app)

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCPKncrIN8WYmrFrOprNVayVzaktutFOkY",
  authDomain: "stratocastle-sala-de-ensayos.firebaseapp.com",
  databaseURL: "https://stratocastle-sala-de-ensayos-default-rtdb.firebaseio.com",
  projectId: "stratocastle-sala-de-ensayos",
  storageBucket: "stratocastle-sala-de-ensayos.firebasestorage.app",
  messagingSenderId: "739579456200",
  appId: "1:739579456200:web:0b4ceb9b22cf31f5ae93fd"
  };
  

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
