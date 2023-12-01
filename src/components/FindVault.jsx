import './FindVault.css';

// Security modules
import { argon2id } from 'hash-wasm';  // "Use Argon2id with minimums of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism." -OWASP
import { sha3_256 } from 'js-sha3';

// Firebase modules
import { firestore } from './config/firebase';
import { storage } from './config/firebase';
import { getDocFromServer, collection } from 'firebase/firestore';

function seedToKey(seedphrase) {
    // Concat seedphrase into a string
    // Hash seedphrase with argon2-256
    // Return the has as string

}

/*
1) Client: take a 12 word BIP39 seedphrase
2) Client: hash this seedphrase with Argon2 256bit. This hash is treated as the user's key.
3) Client: hash the key with SHA3-256 then send to the server via HTTPS.
4) Server: compare received hash to the list of hashes to see if it exists.
5) Server: if exists, send encrypted manifest.json from the user's vault to the client.
6) Client: use the user's key as an AES256 key to decrypt the manifest.
7) Client: use the contents of the manifest (a filesystem tree) to render the user's private vault to their screen.
8) Client: when user opens a file fetch the encrypted file from server then decrypt it.
*/
function FindVault() {
    const seedHashesRef = collection(firestore, 'seed-hashes');

    const checkVaultExists = async (pwd) => {
        // Hash password with SHA3-256
        // Pass to server to see if exists
        // Return manifest if exists else null

    }

    return (
        <>
            <div>


            </div>
        </>
    );
}

export default FindVault;
