const txIndexMap = new Map();
const expirationTimes = new Map();

const checkExpiredEntries = () => {
  const now = Date.now();

  // Iterate through the entries and delete the expired ones
  for (const [key, expirationTime] of expirationTimes.entries()) {
    if (now >= expirationTime) {
      txIndexMap.delete(key);
      expirationTimes.delete(key);
    }
  }
};

const storeData = (key, time) => {
  txIndexMap.set(key, 1);

  const expirationTime = Date.now() + time; // 60000
  expirationTimes.set(key, expirationTime);

  checkExpiredEntries();
};

module.exports = { txIndexMap, storeData };
