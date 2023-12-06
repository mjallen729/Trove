import './FindVault.css';
import { useState } from 'react';

// Security modules
import { argon2id } from 'hash-wasm';  // "Use Argon2id with minimums of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism." -OWASP
import { sha3_256 } from 'js-sha3';
import aes from 'aes-js';

// Firebase modules
import { firestore } from '../config/firebase';
import { storage } from '../config/firebase';
import { getDocFromServer, collection } from 'firebase/firestore';

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
async function argon(key) {
    const argon = await argon2id({
        password: key,
        salt: 'testsalt',
        parallelism: 1,
        iterations: 200,
        memorySize: 5000,  // 5MB
        hashLength: 32,
        outputType: 'encoded',

    });

    return argon;

}

function FindVault() {
    const seedHashesRef = collection(firestore, 'seed-hashes');
    let key = null;

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
        // Hash password with argon2-256
        // Pass to server to see if exists
        // Return manifest if exists else null
        e.preventDefault();

        let seedphraseBlob = '';
        for (var i = 1; i <= 12; i++) {
            seedphraseBlob += seedWords[i + ''];

        }

        key = sha3_256(seedphraseBlob);
        
        let argonHash = null;

        argon(key).then(_argonHash => {
            argonHash = _argonHash;
            console.log(_argonHash);

            // do the rest of it in here!

        });

    }

    return (
        <>
            <div>
                <form onSubmit={checkVaultExists}>
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
