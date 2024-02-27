import './App.css';
import Navbar from './components/Navbar';
import FindVault from './components/FindVault';
import Vault from './components/Vault';
import CreateVault from './components/CreateVault';

import { useState } from 'react';

function App() {
    const [vaultParams, setVaultParams] = useState({
        key: null,
        manifest: null
    });

    return (
        <>
            <Navbar/>
            Overall navigation of the site goes here.
            <br />FindVault
            <br />Vault
            <br />CreateVault
            <br /><br />
            
            <div className="appBody">
                <FindVault callback={ setVaultParams }/>
                <br/><br/>
                <h3>
                    <span className='font-bold text-blue-700'>AES Key: </span>
                    {vaultParams.key}
                </h3>
                <h3>
                    <span className='font-bold text-blue-700'>Manifest: </span>
                    {vaultParams.manifest}
                </h3>


            </div>
        </>
    );
}

export default App;
