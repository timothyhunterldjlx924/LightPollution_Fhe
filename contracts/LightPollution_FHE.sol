// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LightPollution_FHE is SepoliaConfig {
    struct EncryptedObservation {
        uint256 observerId;
        euint32 encryptedBrightness;    // Encrypted sky brightness measurement
        euint32 encryptedLatitude;      // Encrypted latitude coordinate
        euint32 encryptedLongitude;     // Encrypted longitude coordinate
        euint32 encryptedTimestamp;     // Encrypted observation time
        uint256 submissionTime;
    }
    
    struct DecryptedObservation {
        float brightness;
        float latitude;
        float longitude;
        uint256 timestamp;
        bool isRevealed;
    }

    uint256 public observationCount;
    mapping(uint256 => EncryptedObservation) public encryptedObservations;
    mapping(uint256 => DecryptedObservation) public decryptedObservations;
    
    mapping(string => euint32) private encryptedRegionStats;
    string[] private regionList;
    
    mapping(uint256 => uint256) private requestToObservationId;
    
    event ObservationSubmitted(uint256 indexed id, uint256 submissionTime);
    event DecryptionRequested(uint256 indexed id);
    event ObservationDecrypted(uint256 indexed id);
    event PollutionMapUpdated(uint256 indexed regionId);
    
    modifier onlyObserver(uint256 observerId) {
        _;
    }
    
    function submitEncryptedObservation(
        euint32 encryptedBrightness,
        euint32 encryptedLatitude,
        euint32 encryptedLongitude,
        euint32 encryptedTimestamp,
        string memory regionCode
    ) public {
        observationCount += 1;
        uint256 newId = observationCount;
        
        encryptedObservations[newId] = EncryptedObservation({
            observerId: newId,
            encryptedBrightness: encryptedBrightness,
            encryptedLatitude: encryptedLatitude,
            encryptedLongitude: encryptedLongitude,
            encryptedTimestamp: encryptedTimestamp,
            submissionTime: block.timestamp
        });
        
        decryptedObservations[newId] = DecryptedObservation({
            brightness: 0,
            latitude: 0,
            longitude: 0,
            timestamp: 0,
            isRevealed: false
        });
        
        if (!FHE.isInitialized(encryptedRegionStats[regionCode])) {
            encryptedRegionStats[regionCode] = FHE.asEuint32(0);
            regionList.push(regionCode);
        }
        
        emit ObservationSubmitted(newId, block.timestamp);
    }
    
    function requestObservationDecryption(uint256 observationId) public onlyObserver(encryptedObservations[observationId].observerId) {
        EncryptedObservation storage obs = encryptedObservations[observationId];
        require(!decryptedObservations[observationId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(obs.encryptedBrightness);
        ciphertexts[1] = FHE.toBytes32(obs.encryptedLatitude);
        ciphertexts[2] = FHE.toBytes32(obs.encryptedLongitude);
        ciphertexts[3] = FHE.toBytes32(obs.encryptedTimestamp);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptObservation.selector);
        requestToObservationId[reqId] = observationId;
        
        emit DecryptionRequested(observationId);
    }
    
    function decryptObservation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 observationId = requestToObservationId[requestId];
        require(observationId != 0, "Invalid request");
        
        EncryptedObservation storage eObs = encryptedObservations[observationId];
        DecryptedObservation storage dObs = decryptedObservations[observationId];
        require(!dObs.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        float[] memory results = abi.decode(cleartexts, (float[]));
        
        dObs.brightness = results[0];
        dObs.latitude = results[1];
        dObs.longitude = results[2];
        dObs.timestamp = uint256(results[3]);
        dObs.isRevealed = true;
        
        emit ObservationDecrypted(observationId);
    }
    
    function calculateRegionalBrightness(string memory regionCode) public returns (euint32) {
        require(FHE.isInitialized(encryptedRegionStats[regionCode]), "Region not found");
        
        euint32 regionalAvg = FHE.div(
            encryptedRegionStats[regionCode],
            FHE.asEuint32(uint32(observationCount))
        );
        
        emit PollutionMapUpdated(bytes32ToUint(keccak256(abi.encodePacked(regionCode))));
        
        return regionalAvg;
    }
    
    function getDecryptedObservation(uint256 observationId) public view returns (
        float brightness,
        float latitude,
        float longitude,
        uint256 timestamp,
        bool isRevealed
    ) {
        DecryptedObservation storage d = decryptedObservations[observationId];
        return (d.brightness, d.latitude, d.longitude, d.timestamp, d.isRevealed);
    }
    
    function compareBrightness(
        euint32 brightness1,
        euint32 brightness2
    ) public pure returns (ebool) {
        return FHE.gt(brightness1, brightness2);
    }
    
    function checkPollutionThreshold(
        euint32 brightness,
        euint32 threshold
    ) public pure returns (ebool) {
        return FHE.gt(brightness, threshold);
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getRegionFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < regionList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(regionList[i]))) == hash) {
                return regionList[i];
            }
        }
        revert("Region not found");
    }
    
    function aggregateObservations(
        euint32[] memory brightnessValues
    ) public pure returns (euint32) {
        require(brightnessValues.length > 0, "No observations");
        
        euint32 sum = FHE.asEuint32(0);
        for (uint i = 0; i < brightnessValues.length; i++) {
            sum = FHE.add(sum, brightnessValues[i]);
        }
        
        return FHE.div(sum, FHE.asEuint32(uint32(brightnessValues.length)));
    }
}