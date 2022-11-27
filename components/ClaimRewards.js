import { useContext } from "react";
import Button from "./Button";
import { ConnectContext } from "../context/ConnectProvider";
import { REWARD_MANAGER_CONTRACT_ABI, REWARD_MANAGER_CONTRACT_ADDRESS } from "../artifacts/constants";
import { ContractPromise } from "@polkadot/api-contract";

const style = {
  wrapper: `h-screen w-screen flex items-center justify-center mt-14`
};

const ClaimRewards = () => {
 
  const { currentAccount, api } = useContext(ConnectContext);

  const claim = async () => {
    try {

      // maximum gas to be consumed for the call. if limit is too small the call will fail.
      const gasLimit = 30000n * 1000000n;
      // a limit to how much Balance to be used to pay for the storage created by the contract call
      // if null is passed, unlimited balance can be used
      const storageDepositLimit = null;

      const { web3FromSource } = await import("@polkadot/extension-dapp");
      const injector = await web3FromSource(currentAccount.meta.source);
      const rewardManagerContract = new ContractPromise(api, REWARD_MANAGER_CONTRACT_ABI, REWARD_MANAGER_CONTRACT_ADDRESS);

      console.log('Claim ...');
      
      rewardManagerContract.tx['psp22Reward::claim'](
        { storageDepositLimit, gasLimit }
        )
        .signAndSend(
            currentAccount.address,
            {signer: injector.signer}, 
            (result) => {
              console.log('Transaction status:', result.status.type);

              if (result.status.isInBlock || result.status.isFinalized) {
                  console.log('Transaction hash ', result.txHash.toHex());

                  result.events.forEach(({ phase, event : {data, method, section}} ) => {
                      console.log(' %s : %s.%s:: %s', phase, section, method, data);
                      if (section == 'system' && method == 'ExtrinsicSuccess'){
                          console.log('Success');
                      } else if (section == 'system' && method == 'ExtrinsicFailed'){
                          console.log('Failed');
                      }
                  });
              } else if (result.isError){
                  console.log('Error');
              }
          }
        );       
    
    } catch (error) {
      console.log(":( transaction failed", error);
    }
  };
  

  return (
    <div className={style.wrapper}>
      <div onClick={() => claim()}>
        <Button title="Claim" />
      </div>
    </div>
  );
};
export default ClaimRewards;
