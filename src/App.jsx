import './App.css';
import Navbar from './components/Navbar';
import FindVault from './components/FindVault';
import Vault from './components/Vault';
import CreateVault from './components/CreateVault';

function App() {

    return (
        <>
            <Navbar/>
            <div>
                Overall navigation of the site logic goes here:
                Pages:
                    FindVault
                    Vault
                    CreateVault

                <FindVault/>


            </div>
        </>
    );
}

export default App;
