import './Vault.css';

// Security modules
import {} from 'aes-js';

// Firebase modules
import { storage } from './config/firebase';
import { getStorage } from 'firebase/storage';

function Vault(props) {
    // Props: AES key, encrypted manifest
    // Decrypt manifest and render filesystem
    const SECRET = props.key;
    const manifest = props.manifest;

    return (
        <>

        </>
    )

}

export default Vault;