import axios from 'axios'

function getUrl(chainId) {
  return `https://api.thegraph.com/subgraphs/name/hop-protocol/hop-${chainId}`
}

const pollXDai = async () => {
  const url = getUrl(chain.id)
  const query = `transaction(id:"${transactionId}" subgraphError: allow) {
    hash
  }`

  const result = await axios.post(url, query)
}

