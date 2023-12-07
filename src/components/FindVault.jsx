import './FindVault.css';
import { useState } from 'react';

// Security modules
import { sha3_256, sha3_512 } from 'js-sha3';
import aes from 'aes-js';

// Firebase modules
import { firestore } from '../config/firebase';
import { doc, getDoc } from "firebase/firestore";
import { storage } from '../config/firebase';
import { ref } from 'firebase/storage';

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
// Returns encrypted manifest or null
async function checkExistsAsync(keyHash) {
    const docRef = doc(firestore, 'seed-hashes', keyHash);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        // Find the manifest from the vault and return it
        let data = await docSnap.data();
        let vault = data['vault-id'];

        return ref(storage, 'vaults/' + vault + '/manifest.json');

    } else {
        console.log(keyHash);
        return null;

    }

}

function FindVault(props) {
    // Props: a callback function to pass manifest ref
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

    const checkVaultExists = (e) => {
        // Gen AES256 key from seedphrase then pass its hash to server
        // Return manifest if hash exists else null
        e.preventDefault();

        let seedphraseBlob = '';
        for (var i = 1; i <= 12; i++) {
            seedphraseBlob += seedWords[i + ''];

        }

        // Generate the key and it's hash
        let key = sha3_256(seedphraseBlob);
        let keyHash = sha3_256(sha3_512(key));

        checkExistsAsync('hash').then(exists => {  // CHANGED TO HASH TODO CHANGE BACK
            if (exists == null) {
                throw new Error('Vault not found');

            } else {
                // Pass key and manifestRef to callback function
                vaultCallback(prevState => ({
                    ...prevState,
                    key: key + '',
                    manifest: exists + '',
                }));

            }

        });

    }

    return (
        <>
            <div>
                <form onSubmit={ checkVaultExists }>
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

                    <button type="submit">Submit</button>
                </form>
            </div>

        </>
    );
}

export default FindVault;
