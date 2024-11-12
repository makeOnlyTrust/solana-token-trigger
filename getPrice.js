const getSolTokenPrice = async (address) => {
  const QUERY = `
      {
    filterTokens(
      tokens:["${address}:1399811149"]
    ) {
      results {
        priceUSD
        marketCap
        token{
          symbol
        }
      }
    }
  }
      `;

  const { data } = await axios.post(
    endpoint,
    {
      query: QUERY,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: API_KEY,
      },
    }
  );

  return data?.data?.filterTokens?.results[0];
};

module.exports = { getSolTokenPrice };
