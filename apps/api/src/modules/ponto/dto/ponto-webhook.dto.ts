export interface PontoWebhookPayload {
  data: {
    id: string;
    type: string;
    attributes: {
      eventType: string;
      synchronizationId?: string;
      accountId?: string;
      organizationId?: string;
      count?: number;
    };
  };
}
