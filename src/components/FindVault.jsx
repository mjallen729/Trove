import './FindVault.css';
import { useState } from 'react';
import { saveAs } from "file-saver";

// Security modules
import { sha3_256, sha3_512 } from 'js-sha3';
import aes from 'aes-js';

// Firebase modules
import { firestore } from '../config/firebase';
import { doc, getDoc } from "firebase/firestore";
import { storage } from '../config/firebase';
import { getBytes, list, ref } from 'firebase/storage';

/*
1) Client: take a 12 word BIP39 seedphrase
2) Client: hash this seedphrase with SHA3-256. This hash is treated as the user's key.
3) Client: hash the key with Argon2 256bit then send to the server via HTTPS.
4) Server: compare received hash to the list of hashes to see if it exists.
5) Server: if exists, send the encrypted manifest.json from the user's vault to the client.
6) Client: use the user's key as an AES256 key to decrypt the manifest. Get vault id from manifest.
           If vault_id exists...
7) Client: use the contents of the manifest (a filesystem tree) to render user's vault to their screen.
8) Client: when user opens a file fetch the encrypted file from server then decrypt it.
*/

// Does all the async work to check if key exists.
// Returns encrypted file or null
async function checkExistsAsync(keyHash) {
    const docRef = doc(firestore, 'seed-hashes', keyHash);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        let data = await docSnap.data();
        let vault = data['vault-id'];

        // for mvp just download the file (vault is single file)
        let vault_ref = ref(storage, `vaults/${vault}`);
        let vault_contents = await list(vault_ref);
        
        let fileRef = vault_contents.items[0];
        let rawArrayBuffer = await getBytes(fileRef);

        return rawArrayBuffer

        /*
            const response = await fetch(API_URL_HERE);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const fileType = await FileType.fromBuffer(buffer);
            if (fileType.ext) {
                const outputFileName = `yourfilenamehere.${fileType.ext}`
                fs.createWriteStream(outputFileName).write(buffer);
            } else {
                console.log('File type could not be reliably determined! The binary data may be malformed! No file saved!')
            }
        */

    } else {
        console.log(keyHash);
        return null;

    }

}

function FindVault(props) {
    // Props: a callback function to pass a snapshot of vault manifest to
    const vaultCallback = props.callback;
    
    const [seedWords, setSeedWords] = useState({
        1: '',
        2: '',
        3: '',
        4: '',
        5: '',
        6: '',
        7: '',
        8: '',
        9: '',
        10: '',
        11: '',
        12: '',

    });

    const handleChange = (e) => {
        const {name, value} = e.target;
        setSeedWords({...seedWords, [name]: value});

    }

    // Gen AES256 key from seedphrase then pass its hash to server
    // Return manifest if hash exists else null
    const checkVaultExists = (e) => {
        e.preventDefault();

        // Set to loading
        vaultCallback(prevState => ({
            ...prevState,
            key: 'Loading...',
            manifest: 'Loading...',

        }));

        let seedphraseBlob = '';
        for (var i = 1; i <= 12; i++) {
            seedphraseBlob += seedWords[i + ''];

        }

        // Check if the form input is valid (WIP)
        if (seedphraseBlob.length < 12) {
            throw new Error('Invalid seed phrase');

        }

        // Generate the aes key and it's hash
        let aesKey = sha3_256(seedphraseBlob);
        let aesKeyHash = sha3_256(sha3_512(aesKey));

        checkExistsAsync('hash').then(bytes => {  // Changed to 'hash'; TODO: change back to keyHash
            if (bytes.byteLength == 0) {
                throw new Error(`Recieved no bytes! Vault does not exist.`);

            }

            console.log(bytes)

            vaultCallback(prevState => ({
                ...prevState,
                key: aesKey + '',
                manifest: 'len ' + bytes.byteLength,

            }));

            // Decrypt the bytes using aes module

            // Download the file
            

            

        });

    }

    return (
        <>
            <div>
                <form onSubmit={ checkVaultExists } id="seedForm">
                    <div id="seedFormGrid">
                        <input
                            type="text"
                            name="1"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="2"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="3"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="4"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="5"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="6"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="7"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="8"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="9"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="10"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="11"
                            value={seedWords.name}
                            onChange={handleChange}
                        />
                        <input
                            type="text"
                            name="12"
                            value={seedWords.name}
                            onChange={handleChange}
                        />

                    </div>

                    <div id="seedFormButtons">
                        <button type="submit" id="seedFormSubmitButton">Submit</button>
                        <button type="button" id="createVaultButton">Create</button>

                    </div>
                </form>
            </div>

        </>
    );
}

export default FindVault;
