import type { DashboardSnapshot } from "@legal-agent/shared";

export const sampleData: DashboardSnapshot = {
  attorneys: [
    {
      id: "att-1",
      fullName: "Aarav Mehta",
      email: "aarav@firm.example",
      role: "partner",
      practiceArea: "M&A"
    },
    {
      id: "att-2",
      fullName: "Riya Shah",
      email: "riya@firm.example",
      role: "associate",
      practiceArea: "Commercial Contracts"
    }
  ],
  matters: [
    {
      id: "mat-1",
      matterCode: "MNA-2026-014",
      title: "Acquisition of Zenith Logistics",
      clientName: "Meridian Capital",
      matterType: "M&A Due Diligence",
      status: "open",
      jurisdiction: "India",
      responsibleAttorneyId: "att-1"
    }
  ],
  documents: [
    {
      id: "doc-1",
      tenantId: "tenant-demo",
      matterId: "mat-1",
      sourceName: "Share Purchase Agreement - Draft 3.pdf",
      mimeType: "application/pdf",
      docType: "Share Purchase Agreement",
      ingestionStatus: "normalized",
      securityStatus: "clean",
      privilegeScore: 0.11,
      relevanceScore: 0.94,
      normalizedText:
        "Governing Law. This Agreement shall be governed by the laws of Singapore. Indemnity. The Sellers shall indemnify the Buyer, provided that the aggregate liability cap shall be equal to 100% of the Purchase Price. Assignment. Buyer may assign this Agreement without prior consent.",
      embedding: [0.2, 0.4, 0.1, 0.6, 0.3, 0.5]
    }
  ],
  clauses: [
    {
      id: "cl-1",
      documentId: "doc-1",
      clauseType: "governing_law",
      heading: "Governing Law",
      textExcerpt: "This Agreement shall be governed by the laws of Singapore.",
      pageFrom: 12,
      pageTo: 12,
      riskLevel: "high",
      confidence: 0.96,
      reviewerStatus: "pending"
    },
    {
      id: "cl-2",
      documentId: "doc-1",
      clauseType: "indemnity",
      heading: "Indemnity",
      textExcerpt:
        "The Sellers shall indemnify the Buyer, provided that the aggregate liability cap shall be equal to 100% of the Purchase Price.",
      pageFrom: 18,
      pageTo: 19,
      riskLevel: "high",
      confidence: 0.94,
      reviewerStatus: "pending"
    }
  ],
  flags: [
    {
      id: "flag-1",
      matterId: "mat-1",
      documentId: "doc-1",
      clauseId: "cl-1",
      flagType: "deviation",
      severity: "critical",
      reason: "Domestic deal playbook prefers Indian governing law, but the clause uses Singapore law.",
      confidence: 0.96,
      status: "open"
    },
    {
      id: "flag-2",
      matterId: "mat-1",
      documentId: "doc-1",
      clauseId: "cl-2",
      flagType: "deviation",
      severity: "critical",
      reason: "Indemnity cap exceeds the firm's preferred 20% limit.",
      confidence: 0.94,
      status: "open"
    }
  ]
};
