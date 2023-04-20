import React, { useState, useEffect, useContext } from "react";
import { Abi, ContractPromise } from "@polkadot/api-contract";
import { ApiContext } from "../context/ApiProvider";
import { AccountContext } from "../context/AccountProvider";
import { REWARD_MANAGER_CONTRACT_ABI_METADATA, REWARD_MANAGER_CONTRACT_ADDRESS, DAPP_STAKING_APPLICATION_CONTRACT_ADDRESS } from "../artifacts/constants";
import BN from "bn.js"
import toast from 'react-hot-toast';

export const ContractContext = React.createContext();

export const ContractProvider = ({ children }) => {
  const { api, network } = useContext(ApiContext);
  const { account } = useContext(AccountContext);
  const [rewardManagerContract, setRewardManagerContract] = useState();
  const [claimDryRunRes,setClaimDryRunRes] = useState(undefined)
  const [currentEra,setCurrentEra] = useState(undefined)
  const [currentEraStake,setCurrentEraStake] = useState(undefined)

  useEffect(() => {
    //console.log("loadRewardManagerContract")
    if (api) loadRewardManagerContract();
  }, [api]);
  
  useEffect(()=>{
    if (rewardManagerContract && account) {
      doDryRun();
    }
  },[rewardManagerContract,account])

  useEffect(()=>{
    if (api) subscribeCurrentEra()
  },[api])

  const subscribeCurrentEra = async ()=>{
    const unsub = await api.query.dappsStaking.currentEra(
      (era) => {
        console.log("ERA",era.toString());
        setCurrentEra(era.toString())
        getCurrentEraStake(era.toString())
      }
    );
  }

  const getCurrentEraStake = async (era)=>{
    if(era) {
      const stake = await api.query.dappsStaking.contractEraStake({"Wasm":DAPP_STAKING_APPLICATION_CONTRACT_ADDRESS},era);
      if (stake) {
        console.log("UNWRAP.STAKE",stake)
        setCurrentEraStake(stake.unwrap().total.toString())
        console.log("STAKE",stake.unwrap().total.toString())
      }
    }
  }

  const doDryRun = async () => {
    const { gasRequired, result, error } = await claimDryRun();
    const res = { gasRequired, result, error }
    setClaimDryRunRes(res)
    return res
  }

  /*
  function getErrorDescription(errindex,errno) {
    //console.log("#####",metadata['lookup']['types'])
    const metadata = REWARD_MANAGER_CONTRACT_ABI_METADATA
    const pallet = metadata.pallets.find(ele => ele.index == errindex)
    //console.log(pallet)
    const type = metadata['lookup']['types'].find((ele => ele.id == pallet.errors.type))
    const variant = type['type']['def']['Variant']['variants'].find(ele => ele.index == errno)
    const description = variant['docs'].join(' ');
    return description;
  }*/

  const loadRewardManagerContract = async () => {
    try { 
      const abi = new Abi(REWARD_MANAGER_CONTRACT_ABI_METADATA, api.registry.getChainProperties());
      const contract = new ContractPromise(api, abi, REWARD_MANAGER_CONTRACT_ADDRESS);
      //console.log("CONTRACT-----",contract)
      
      setRewardManagerContract(contract);
    } catch (error) {
      console.error("Error in loadRewardManagerContract", error);
    }
  };

  const claimDryRun = async()=>{
    console.log("sending DryRun on "+network+" for contract: ",rewardManagerContract.address.toString())
    // Get the initial gas WeightV2 using api.consts.system.blockWeights['maxBlock']
    const gasLimit = api.registry.createType(
      'WeightV2',
      api.consts.system.blockWeights['maxBlock']
    )
    // Query the contract message
    // This will return the gas required and storageDeposit to execute the message
    // and the result of the message
    const rewardManagerContractPromise = rewardManagerContract.query["psp22Reward::claim"](
      account.address,
      {
        gasLimit: gasLimit,
        storageDepositLimit: null
      }
    )
    /*
    toast.promise(
      rewardManagerContractPromise, 
      {
        loading: 'Loading Contract',
        success: 'Lycky contract loaded',
        error: 'Error when loading to the Lucky contract',
      },
      {
        position: 'bottom-right',
        style: {
          minWidth: '250px',
        },
        success: {
          duration: 3000,
          icon: '🍀',
        },
      }
    );
    */
    const { gasRequired, storageDeposit, result } = await rewardManagerContractPromise;

    // Check for errors
    let error = undefined
    if (result.isErr) {
      if (result.asErr.isModule) {
        const dispatchError = api.registry.findMetaError(result.asErr.asModule)
        error = dispatchError.docs.length ? dispatchError.docs.concat().toString() : dispatchError.name
      } else {
        error = result.asErr.toString()
      }
    }

    // Even if the result is Ok, it could be a revert in the contract execution
    if (result.isOk) {
      const flags = result.asOk.flags.toHuman()
      // Check if the result is a revert via flags
      if (flags.includes('Revert')) {
        const type = rewardManagerContract.abi.messages[5].returnType // here 5 is the index of the message in the ABI
        const typeName = type?.lookupName || type?.type || ''
        error = rewardManagerContract.abi.registry.createTypeUnsafe(typeName, [result.asOk.data]).toHuman()
        error = error ? error.Ok.Err.toString() : 'Revert'
      }
    }
    console.log("DryRun error?:",error)
    return { gasRequired, storageDeposit, result, error }
  }

  const getEstimatedGas = (gasRequired) => {
      // Gas require is more than gas returned in the query
      // To be safe, we double the gasLimit.
      // Note, doubling gasLimit will not cause spending more gas for the Tx
      const BN_TWO = new BN(2);
      return api.registry.createType(
        'WeightV2',
        {
          refTime: gasRequired.refTime.toBn().mul(BN_TWO),
          proofSize: gasRequired.proofSize.toBn().mul(BN_TWO),
        }
      )
  }

  const claim = async () => {
    const res = await doDryRun()
    const { gasRequired, error } = res
    //console.log("DRYRUNRES",gasRequired, result, error)
    
    if (error) {
      toast.error(
        error,
        {position: 'bottom-right'}
      )
      //return
    }
    const txToast = toast.loading(
      'Sending Transaction...',
      {
        position: 'bottom-right',
      }
    );

    //if (!error) {
    let txError = undefined;
    const unsub = await rewardManagerContract.tx["psp22Reward::claim"]({
      gasLimit: getEstimatedGas(gasRequired),
      storageDepositLimit: null
    })
    .signAndSend(
      account.address,
      (res) => {
        //console.log("RES.events",res.events)
        res.events.forEach(({ phase, event: { data, method, section } }) => {
          if (method === "ExtrinsicFailed") {
            txError = "ExtrinsicFailed"
            /*
            const data_obj = JSON.parse(data.toString())
            const errindex = data_obj[0]['module']['index']
            const errno = parseInt(data_obj[0]['module']['error'].substr(2, 2),16);
            txError = getErrorDescription(errindex,errno)
            console.log("txError",errindex,errno,txError)
            */
          }
          //console.log('\t', phase.toString(), `: ${section}.${method}`, data.toString());
          //console.log("status",res.status.toString())
        });
        
      //console.log("method",res.method,res.data.toString())
      if (res.status.isInBlock) {
        toast.loading('Transaction is in block',{id:txToast});
      }
      if (res.status.isFinalized) {
        toast.dismiss(txToast)
        let txMessage;
        if (txError) txMessage="Transaction Failed ("+txError+")"
        else txMessage="Transaction sent successfully"
        const toastValue = (t) => (
          <span className="toast-tx-result text-right">
            {txMessage}<br/><a target="_blank" href={"https://"+network+".subscan.io/extrinsic/"+res.txHash.toHex()}>show in Subscan</a>
            <button className="btn-tx-result" onClick={() => toast.dismiss(t.id)}> close </button>
          </span>
        )
        const toastOptions = {
          duration: 6000000,
          position: 'bottom-right',
          style: {maxWidth:600},
        }
        if (txError) toast.error(toastValue,toastOptions);
        else toast(toastValue,toastOptions);
        unsub()
      }
    }).catch((error) => {
      toast.dismiss(txToast)
      toast.error("Transaction Failed: "+error.toString(),{
        position: 'bottom-right',
        style: {maxWidth:600},
      });
    });     
    //}
  }

  return (
    <ContractContext.Provider
      value={{
        rewardManagerContract,
        claim,
        claimDryRun,
        claimDryRunRes,
        currentEra,
        currentEraStake
      }}
    >
      {children}
    </ContractContext.Provider>
  );
};