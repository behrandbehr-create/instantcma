// api/generate-cma.js - Vercel Serverless Function
const Anthropic = require('@anthropic-ai/sdk');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType } = require('docx');
const { IncomingForm } = require('formidable');
const fs = require('fs');

module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Parse form data - Using IncomingForm directly
        const form = new IncomingForm({ 
            maxFileSize: 20 * 1024 * 1024,
            multiples: true 
        });
        
        const [fields, files] = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                resolve([fields, files]);
            });
        });

        // Extract fields
        const apiKey = Array.isArray(fields.apiKey) ? fields.apiKey[0] : fields.apiKey;
        const notes = Array.isArray(fields.notes) ? fields.notes[0] : fields.notes;
        
        // Determine which API key to use
        const isPaid = apiKey === 'USE_SERVER_KEY';
        const effectiveKey = isPaid ? process.env.ANTHROPIC_API_KEY : apiKey;

        if (!effectiveKey) {
            return res.status(400).json({ error: 'API key required' });
        }

        console.log(`Generating CMA - Tier: ${isPaid ? 'Paid' : 'Free'}`);

        // Process files
        const fileArray = files.files ? (Array.isArray(files.files) ? files.files : [files.files]) : [];
        
        if (fileArray.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileContents = fileArray.map(file => ({
            name: file.originalFilename || file.newFilename,
            data: fs.readFileSync(file.filepath).toString('base64'),
            type: file.mimetype
        }));

        // Initialize Anthropic
        const anthropic = new Anthropic({ apiKey: effectiveKey });

        // Call Claude API
        const analysis = await callClaude(anthropic, fileContents, notes);
        
        // Generate Word document
        const docBuffer = await generateWordDocument(analysis);

        // Return document
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename=CMA_Report.docx');
        res.send(Buffer.from(docBuffer));

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to generate CMA', 
            details: error.message 
        });
    }
}

async function callClaude(anthropic, files, notes) {
    let prompt = `I need you to create a comprehensive CMA for this property. I've uploaded ${files.length} files.`;

    if (notes) {
        prompt += `\n\nADDITIONAL CONTEXT FROM AGENT:\n${notes}\n`;
    }

    prompt += `

Please complete the following analysis:

STEP 1: VERIFY PROPERTY DATA
- If tax records are provided, automatically cross-reference bed/bath/sqft with Zillow, Realtor.com
- Only flag discrepancies - show comparison data if something doesn't match

STEP 2: ANALYZE COMPARABLES
- Read ALL property descriptions carefully in the "Agent Condensed" PDF
- Pay attention to condition, updates, lot characteristics
- Check for seller concessions and adjust prices accordingly

STEP 3: WEIGHT AND SCALE COMPS
- Give more weight to closer matches in sqft, condition, location
- Downweight properties that differ significantly

STEP 4: PRICING ANALYSIS
- Provide recommended list price with rationale
- Include price per square foot analysis
- Show expected sale price range and timeline
- Calculate net proceeds

STEP 5: CREATE AGENT CONTACT TABLE
- Extract agent contact information from "One Line CMA"
- Include: Address, Sale Price, CDOM, Agent Name, Brokerage, Phone, Email

STEP 6: FORMAT OUTPUT
Please structure your response as JSON with these sections:
{
  "propertyAddress": "address",
  "recommendedPrice": 650000,
  "priceRange": { "low": 635000, "high": 675000 },
  "pricePerSF": 195,
  "netProceeds": 580000,
  "daysOnMarket": 45,
  "activeCompetition": [
    { "address": "", "listPrice": 0, "pricePerSF": 0, "bedBath": "", "sqft": 0, "year": 0, "dom": 0 }
  ],
  "recentSales": [
    { "address": "", "soldPrice": 0, "pricePerSF": 0, "bedBath": "", "sqft": 0, "year": 0, "saleDate": "", "concessions": 0 }
  ],
  "topComps": [
    { "address": "", "soldPrice": 0, "details": "detailed analysis", "reason": "why this comp is relevant" }
  ],
  "agentContacts": [
    { "address": "", "price": 0, "cdom": 0, "agent": "", "brokerage": "", "phone": "", "email": "" }
  ],
  "marketInsights": ["insight 1", "insight 2"],
  "investmentAnalysis": {
    "purchasePrice": 0,
    "downPayment": 0,
    "projectedProceeds": 0,
    "totalProfit": 0,
    "cashOnCashReturn": "865%",
    "annualizedReturn": "91%"
  }
}

Return ONLY the JSON, no other text.`;

    const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
            role: 'user',
            content: prompt
        }]
    });

    const responseText = message.content[0].text;
    const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    return JSON.parse(jsonText);
}

async function generateWordDocument(data) {
    const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
    const borders = { top: border, bottom: border, left: border, right: border };
    
    const children = [];

    // Title
    children.push(
        new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Comparative Market Analysis", bold: true })]
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: data.propertyAddress || "Property Address" })]
        }),
        new Paragraph({ text: "" })
    );

    // Investment Performance (if available)
    if (data.investmentAnalysis) {
        const inv = data.investmentAnalysis;
        children.push(
            new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: "Your Investment Performance", bold: true })]
            })
        );

        const invTable = new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [9360],
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            borders,
                            shading: { fill: "D5E8F0", type: ShadingType.CLEAR },
                            margins: { top: 120, bottom: 120, left: 120, right: 120 },
                            width: { size: 9360, type: WidthType.DXA },
                            children: [
                                new Paragraph({ children: [new TextRun({ text: "Investment Summary", bold: true })] }),
                                new Paragraph({ children: [new TextRun(`Initial Investment: $${inv.downPayment?.toLocaleString()}`)] }),
                                new Paragraph({ children: [new TextRun(`Projected Net Proceeds: $${inv.projectedProceeds?.toLocaleString()}`)] }),
                                new Paragraph({ children: [new TextRun(`Total Profit: $${inv.totalProfit?.toLocaleString()}`)] }),
                                new Paragraph({ children: [new TextRun({ text: `Cash-on-Cash Return: ${inv.cashOnCashReturn}`, bold: true })] }),
                                new Paragraph({ children: [new TextRun({ text: `Annualized Return: ${inv.annualizedReturn}`, bold: true })] })
                            ]
                        })
                    ]
                })
            ]
        });
        children.push(invTable, new Paragraph({ text: "" }));
    }

    // Key Market Findings
    children.push(
        new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: "Key Market Findings", bold: true })]
        })
    );

    const findingsTable = new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [
            new TableRow({
                children: [
                    new TableCell({
                        borders,
                        shading: { fill: "FFF4CC", type: ShadingType.CLEAR },
                        margins: { top: 120, bottom: 120, left: 120, right: 120 },
                        width: { size: 9360, type: WidthType.DXA },
                        children: [
                            new Paragraph({ children: [new TextRun(`Recommended List Price: $${data.priceRange?.low?.toLocaleString()} - $${data.priceRange?.high?.toLocaleString()}`)] }),
                            new Paragraph({ children: [new TextRun(`Price Per Square Foot: $${data.pricePerSF}`)] }),
                            new Paragraph({ children: [new TextRun(`Expected Days on Market: ${data.daysOnMarket} days`)] }),
                            new Paragraph({ children: [new TextRun(`Estimated Net Proceeds: $${data.netProceeds?.toLocaleString()}`)] })
                        ]
                    })
                ]
            })
        ]
    });
    children.push(findingsTable, new Paragraph({ text: "" }));

    // Active Competition Table
    if (data.activeCompetition && data.activeCompetition.length > 0) {
        children.push(
            new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: "Active Competition", bold: true })]
            })
        );

        const compRows = [
            new TableRow({
                children: [
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 2000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Address", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1500, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "List Price", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "$/SF", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Bed/Bath", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Sq Ft", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Year", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1460, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "DOM", bold: true, color: "FFFFFF" })] })] })
                ]
            })
        ];

        data.activeCompetition.forEach(comp => {
            compRows.push(
                new TableRow({
                    children: [
                        new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ text: comp.address })] }),
                        new TableCell({ borders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ text: `$${comp.listPrice?.toLocaleString()}` })] }),
                        new TableCell({ borders, width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ text: `$${comp.pricePerSF}` })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: comp.bedBath })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: comp.sqft?.toLocaleString() })] }),
                        new TableCell({ borders, width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ text: String(comp.year) })] }),
                        new TableCell({ borders, width: { size: 1460, type: WidthType.DXA }, children: [new Paragraph({ text: String(comp.dom) })] })
                    ]
                })
            );
        });

        const compTable = new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [2000, 1500, 1000, 1200, 1200, 1000, 1460],
            rows: compRows
        });
        children.push(compTable, new Paragraph({ text: "" }));
    }

    // Recent Sales Table
    if (data.recentSales && data.recentSales.length > 0) {
        children.push(
            new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: "Recent Sales", bold: true })]
            })
        );

        const salesRows = [
            new TableRow({
                children: [
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 2000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Address", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1500, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Sold Price", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "$/SF", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Bed/Bath", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Sq Ft", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1000, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Year", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1460, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Sale Date", bold: true, color: "FFFFFF" })] })] })
                ]
            })
        ];

        data.recentSales.forEach(sale => {
            salesRows.push(
                new TableRow({
                    children: [
                        new TableCell({ borders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ text: sale.address })] }),
                        new TableCell({ borders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ text: `$${sale.soldPrice?.toLocaleString()}` })] }),
                        new TableCell({ borders, width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ text: `$${sale.pricePerSF}` })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: sale.bedBath })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: sale.sqft?.toLocaleString() })] }),
                        new TableCell({ borders, width: { size: 1000, type: WidthType.DXA }, children: [new Paragraph({ text: String(sale.year) })] }),
                        new TableCell({ borders, width: { size: 1460, type: WidthType.DXA }, children: [new Paragraph({ text: sale.saleDate })] })
                    ]
                })
            );
        });

        const salesTable = new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [2000, 1500, 1000, 1200, 1200, 1000, 1460],
            rows: salesRows
        });
        children.push(salesTable, new Paragraph({ text: "" }));
    }

    // Agent Contacts Table
    if (data.agentContacts && data.agentContacts.length > 0) {
        children.push(
            new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: "Agent Contacts for Follow-Up", bold: true })]
            })
        );

        const agentRows = [
            new TableRow({
                children: [
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1800, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Address", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Price", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 800, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "CDOM", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1500, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Agent", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1500, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Brokerage", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1200, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Phone", bold: true, color: "FFFFFF" })] })] }),
                    new TableCell({ borders, shading: { fill: "4472C4", type: ShadingType.CLEAR }, width: { size: 1360, type: WidthType.DXA },
                        children: [new Paragraph({ children: [new TextRun({ text: "Email", bold: true, color: "FFFFFF" })] })] })
                ]
            })
        ];

        data.agentContacts.forEach(contact => {
            agentRows.push(
                new TableRow({
                    children: [
                        new TableCell({ borders, width: { size: 1800, type: WidthType.DXA }, children: [new Paragraph({ text: contact.address })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: `$${contact.price?.toLocaleString()}` })] }),
                        new TableCell({ borders, width: { size: 800, type: WidthType.DXA }, children: [new Paragraph({ text: String(contact.cdom) })] }),
                        new TableCell({ borders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ text: contact.agent })] }),
                        new TableCell({ borders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ text: contact.brokerage })] }),
                        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, children: [new Paragraph({ text: contact.phone })] }),
                        new TableCell({ borders, width: { size: 1360, type: WidthType.DXA }, children: [new Paragraph({ text: contact.email })] })
                    ]
                })
            );
        });

        const agentTable = new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [1800, 1200, 800, 1500, 1500, 1200, 1360],
            rows: agentRows
        });
        children.push(agentTable, new Paragraph({ text: "" }));
    }

    // Market Insights
    if (data.marketInsights && data.marketInsights.length > 0) {
        children.push(
            new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: "Market Insights", bold: true })]
            })
        );

        data.marketInsights.forEach(insight => {
            children.push(
                new Paragraph({
                    children: [new TextRun(`• ${insight}`)]
                })
            );
        });
    }

    // Create document
    const doc = new Document({
        styles: {
            default: { document: { run: { font: "Arial", size: 24 } } },
            paragraphStyles: [
                { 
                    id: "Heading1", 
                    name: "Heading 1", 
                    basedOn: "Normal", 
                    next: "Normal", 
                    quickFormat: true,
                    run: { size: 32, bold: true, font: "Arial" },
                    paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
                },
                { 
                    id: "Heading2", 
                    name: "Heading 2", 
                    basedOn: "Normal", 
                    next: "Normal", 
                    quickFormat: true,
                    run: { size: 28, bold: true, font: "Arial" },
                    paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 }
                }
            ]
        },
        sections: [{
            properties: {
                page: {
                    size: {
                        width: 12240,
                        height: 15840
                    },
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            children
        }]
    });

    return await Packer.toBuffer(doc);
}

// Vercel serverless function configuration
module.exports.config = {
    api: {
        bodyParser: false,
        responseLimit: '10mb',
    },
};