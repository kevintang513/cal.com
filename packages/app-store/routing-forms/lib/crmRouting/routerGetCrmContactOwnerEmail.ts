import { getCRMContactOwnerForRRLeadSkip } from "@calcom/app-store/_utils/CRMRoundRobinSkip";
import { EventTypeRepository } from "@calcom/lib/server/repository/eventType";
import { SchedulingType } from "@calcom/prisma/enums";

import type { LocalRoute } from "../../types/types";
import { enabledAppSlugs } from "../enabledApps";

function findProspectEmail(identifierKeyedResponse: Record<string, string | string[]> | null): string | null {
  if (!identifierKeyedResponse) return null;

  for (const identifier of Object.keys(identifierKeyedResponse)) {
    if (identifier === "email") {
      const fieldResponse = identifierKeyedResponse[identifier];
      return fieldResponse instanceof Array ? fieldResponse[0] : fieldResponse;
    }
  }
  return null;
}

async function findContactOwnerFromCRM(
  prospectEmail: string,
  attributeRoutingConfig: LocalRoute["attributeRoutingConfig"],
  eventTypeId: number
): Promise<{ email: string | null; recordType: string | null; crmAppSlug: string | null }> {
  for (const appSlug of enabledAppSlugs) {
    const routingOptions = attributeRoutingConfig?.[appSlug as keyof typeof attributeRoutingConfig];

    if (!routingOptions) continue;

    if (Object.values(routingOptions).some((option) => option === true)) {
      const appBookingFormHandler = (await import("@calcom/app-store/routing-forms/appBookingFormHandler"))
        .default;
      const appHandler = appBookingFormHandler[appSlug as keyof typeof appBookingFormHandler];

      const ownerQuery = await appHandler(prospectEmail, attributeRoutingConfig, eventTypeId);

      if (ownerQuery?.email) {
        return { ...ownerQuery, crmAppSlug: appSlug };
      }
    }
  }

  return {
    email: null,
    recordType: null,
    crmAppSlug: null,
  };
}

export default async function routerGetCrmContactOwnerEmail({
  attributeRoutingConfig,
  identifierKeyedResponse,
  action,
}: {
  attributeRoutingConfig: LocalRoute["attributeRoutingConfig"];
  identifierKeyedResponse: Record<string, string | string[]> | null;
  action: LocalRoute["action"];
}) {
  if (attributeRoutingConfig?.skipContactOwner) return null;

  const prospectEmail = findProspectEmail(identifierKeyedResponse);
  if (!prospectEmail) return null;

  if (action.type !== "eventTypeRedirectUrl" || !action.eventTypeId) return null;

  const eventType = await EventTypeRepository.findByIdIncludeHostsAndTeam({ id: action.eventTypeId });
  if (!eventType || eventType.schedulingType !== SchedulingType.ROUND_ROBIN) return null;

  const eventTypeMetadata = eventType.metadata;
  if (!eventTypeMetadata) return null;

  let contactOwner = await findContactOwnerFromCRM(prospectEmail, attributeRoutingConfig, action.eventTypeId);

  if (!contactOwner.email && !contactOwner.recordType) {
    const ownerQuery = await getCRMContactOwnerForRRLeadSkip(prospectEmail, eventTypeMetadata);
    if (ownerQuery?.email) contactOwner = ownerQuery;
  }

  if (!contactOwner.email && !contactOwner.recordType) return null;

  if (!eventType.hosts.some((host) => host.user.email === contactOwner.email)) return null;

  return contactOwner;
}
