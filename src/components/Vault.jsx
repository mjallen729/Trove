import './Vault.css';

// Security modules
import aes from 'aes-js';

// Firebase modules
import { storage } from '../config/firebase';
import { getStorage } from 'firebase/storage';

function render(json) {

    
}

function Vault(props) {
    // Props: AES key, encrypted manifest
    // Use the decrypted manifest to render filesystem
    const SECRET = props.key;
    const manifest = props.manifest;  // decrypted already

    return (
        <>

        </>
    )

}

export default Vault;