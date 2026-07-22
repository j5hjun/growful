import { createPortalContracts } from "./portal-client-contracts.js"
import { getPortalElements } from "./portal-client-elements.js"
import { bindPortalInteractions } from "./portal-client-interactions.js"
import { createPortalView } from "./portal-client-view.js"
import { bindTokenSafetyActions } from "./token-safety.js"

type PortalClientFactories = {
  readonly bindInteractions: typeof bindPortalInteractions
  readonly bindTokenSafety: typeof bindTokenSafetyActions
  readonly createContracts: typeof createPortalContracts
  readonly createView: typeof createPortalView
  readonly getElements: typeof getPortalElements
}

function initializePortal(factories: PortalClientFactories): void {
  factories.bindTokenSafety()
  const elements = factories.getElements()
  if (elements === null) return
  const contracts = factories.createContracts()
  const view = factories.createView(elements, contracts)
  view.setActionState("initial")
  factories.bindInteractions(elements, contracts, view)
}

export const portalClientScript = `(${initializePortal.toString()})({bindInteractions:(${bindPortalInteractions.toString()}),bindTokenSafety:(${bindTokenSafetyActions.toString()}),createContracts:(${createPortalContracts.toString()}),createView:(${createPortalView.toString()}),getElements:(${getPortalElements.toString()})})`
