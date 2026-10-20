import { FakeMailProvider } from "./fake-provider.js";
import { describeMailProviderContract } from "./mail-provider-contract.js";

describeMailProviderContract("FakeMailProvider", (emails) => {
  const provider = new FakeMailProvider({ emails });

  return {
    provider,
    isTrashed: (id) => Promise.resolve(provider.isTrashed(id)),
  };
});
