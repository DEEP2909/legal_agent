import type { DashboardSnapshot } from "@legal-agent/shared";

export const sampleData: DashboardSnapshot = {
  attorneys: [
    {
      id: "att-1",
      fullName: "Sarah Mitchell",
      email: "sarah.mitchell@firm.example",
      role: "partner",
      practiceArea: "M&A"
    },
    {
      id: "att-2",
      fullName: "James Chen",
      email: "james.chen@firm.example",
      role: "associate",
      practiceArea: "Commercial Contracts"
    },
    {
      id: "att-3",
      fullName: "Aarav Mehta",
      email: "aarav@firm.example",
      role: "partner",
      practiceArea: "Cross-Border M&A"
    }
  ],
  matters: [
    {
      id: "mat-1",
      matterCode: "MNA-2026-014",
      title: "Acquisition of TechFlow Inc.",
      clientName: "Pacific Ventures LLC",
      matterType: "M&A Due Diligence",
      status: "open",
      jurisdiction: "Delaware, US",
      responsibleAttorneyId: "att-1"
    },
    {
      id: "mat-2",
      matterCode: "MNA-2026-015",
      title: "Joint Venture - Zenith Logistics",
      clientName: "Meridian Capital",
      matterType: "Cross-Border JV",
      status: "open",
      jurisdiction: "India",
      responsibleAttorneyId: "att-3"
    }
  ],
  documents: [
    {
      id: "doc-1",
      tenantId: "tenant-demo",
      matterId: "mat-1",
      sourceName: "Stock Purchase Agreement - Draft 3.pdf",
      mimeType: "application/pdf",
      docType: "Stock Purchase Agreement",
      ingestionStatus: "normalized",
      securityStatus: "clean",
      privilegeScore: 0.11,
      relevanceScore: 0.94,
      normalizedText:
        "Governing Law. This Agreement shall be governed by the laws of the State of Texas. Indemnity. The Sellers shall indemnify the Buyer, provided that the aggregate liability cap shall be equal to 5x the Purchase Price. Assignment. Buyer may assign this Agreement without prior consent. Insurance. Seller shall maintain general liability insurance of $500,000.",
      embedding: [0.2, 0.4, 0.1, 0.6, 0.3, 0.5]
    },
    {
      id: "doc-2",
      tenantId: "tenant-demo",
      matterId: "mat-2",
      sourceName: "JV Agreement - India Operations.pdf",
      mimeType: "application/pdf",
      docType: "Joint Venture Agreement",
      ingestionStatus: "normalized",
      securityStatus: "clean",
      privilegeScore: 0.08,
      relevanceScore: 0.91,
      normalizedText:
        "Governing Law. This Agreement shall be governed by the laws of Singapore. Dispute Resolution. Any disputes shall be resolved by ICC arbitration in Singapore.",
      embedding: [0.3, 0.5, 0.2, 0.7, 0.4, 0.6]
    }
  ],
  clauses: [
    {
      id: "cl-1",
      documentId: "doc-1",
      clauseType: "governing_law",
      heading: "Governing Law",
      textExcerpt: "This Agreement shall be governed by the laws of the State of Texas.",
      pageFrom: 12,
      pageTo: 12,
      riskLevel: "medium",
      confidence: 0.96,
      reviewerStatus: "pending"
    },
    {
      id: "cl-2",
      documentId: "doc-1",
      clauseType: "indemnity",
      heading: "Indemnity",
      textExcerpt:
        "The Sellers shall indemnify the Buyer, provided that the aggregate liability cap shall be equal to 5x the Purchase Price.",
      pageFrom: 18,
      pageTo: 19,
      riskLevel: "high",
      confidence: 0.94,
      reviewerStatus: "pending"
    },
    {
      id: "cl-3",
      documentId: "doc-1",
      clauseType: "insurance",
      heading: "Insurance",
      textExcerpt: "Seller shall maintain general liability insurance of $500,000.",
      pageFrom: 22,
      pageTo: 22,
      riskLevel: "high",
      confidence: 0.92,
      reviewerStatus: "pending"
    },
    {
      id: "cl-4",
      documentId: "doc-2",
      clauseType: "governing_law",
      heading: "Governing Law",
      textExcerpt: "This Agreement shall be governed by the laws of Singapore.",
      pageFrom: 8,
      pageTo: 8,
      riskLevel: "high",
      confidence: 0.95,
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
      severity: "warn",
      reason: "Texas law specified instead of preferred Delaware, New York, or California law for US deals.",
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
      reason: "Indemnity cap of 5x exceeds the firm's preferred 2x contract value limit.",
      confidence: 0.94,
      status: "open"
    },
    {
      id: "flag-3",
      matterId: "mat-1",
      documentId: "doc-1",
      clauseId: "cl-3",
      flagType: "deviation",
      severity: "critical",
      reason: "Insurance requirement of $500K is below the firm's minimum $1M general liability threshold.",
      confidence: 0.92,
      status: "open"
    },
    {
      id: "flag-4",
      matterId: "mat-2",
      documentId: "doc-2",
      clauseId: "cl-4",
      flagType: "deviation",
      severity: "critical",
      reason: "Indian domestic deal playbook prefers Indian governing law, but the clause uses Singapore law.",
      confidence: 0.95,
      status: "open"
    }
  ]
};
