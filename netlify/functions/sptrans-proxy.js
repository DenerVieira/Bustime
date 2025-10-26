// netlify/functions/sptrans_proxy.js
const fetch = require('node-fetch');

const TOKEN = "c4e93e161ac7beeac6efb8cfecfab38750f3c0e8f96d2df493ef81ad55340ef5";
const API_BASE = "https://api.olhovivo.sptrans.com.br/v2.1";

// Função Centralizada de Autenticação e Requisição
async function authAndFetchSPTrans(endpoint, queryParams) {
    const urlBusca = `${API_BASE}${endpoint}${queryParams}`;

    let apiCredentials = null;

    // --- PASSO A: AUTENTICAÇÃO (POST) ---
    const urlAuth = `${API_BASE}/Login/Autenticar?token=${TOKEN}`;
    const authResponse = await fetch(urlAuth, { method: 'POST' });
    const authBody = await authResponse.text();

    if (authBody.trim() !== 'true') {
        // Lança um erro claro para ser pego pelo bloco try/catch
        throw new Error("Autenticação SPTrans falhou. O Token pode estar expirado ou inválido.");
    }

    // Extração do Cookie
    const setCookieHeader = authResponse.headers.get('set-cookie');
    if (setCookieHeader) {
        const match = setCookieHeader.match(/apiCredentials=([^;]+)/i);
        if (match && match[1]) {
            apiCredentials = `apiCredentials=${match[1]}`;
        }
    }
    
    if (!apiCredentials) {
        throw new Error("Cookie de sessão 'apiCredentials' não foi encontrado após a autenticação.");
    }

    // --- PASSO B: CONSULTA (GET) USANDO O COOKIE ---
    const searchResponse = await fetch(urlBusca, {
        method: 'GET',
        headers: {
            'Cookie': apiCredentials 
        }
    });

    // Se a API retornar um status de erro (400, 500, etc.), ainda tentamos ler o JSON
    if (!searchResponse.ok && searchResponse.status !== 404) {
        const errorData = await searchResponse.json().catch(() => ({ message: "Erro desconhecido na API SPTrans." }));
        throw new Error(`SPTrans retornou status ${searchResponse.status}: ${errorData.message || JSON.stringify(errorData)}`);
    }

    const data = await searchResponse.json();
    return { status: searchResponse.status, data: data };
}

exports.handler = async (event, context) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    // Lemos a operação diretamente da query string
    const operation = event.queryStringParameters.operation;
    
    let endpoint, queryParams;

    if (operation === 'buscar') {
        const termosBusca = event.queryStringParameters.termosBusca;
        if (!termosBusca) {
             return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "O parâmetro 'termosBusca' é obrigatório." }) };
        }
        endpoint = '/Linha/Buscar';
        queryParams = `?termosBusca=${encodeURIComponent(termosBusca)}`;

    } else if (operation === 'previsao') {
        const codigoLinha = event.queryStringParameters.codigoLinha;
        if (!codigoLinha) {
             return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "O parâmetro 'codigoLinha' (cl) é obrigatório." }) };
        }
        endpoint = '/Previsao/Linha';
        queryParams = `?codigoLinha=${codigoLinha}`;

    } else {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: `Operação não especificada ou não suportada: ${operation}. Use 'buscar' ou 'previsao'.` }) };
    }


    try {
        const result = await authAndFetchSPTrans(endpoint, queryParams);
        
        return {
            statusCode: result.status,
            headers: corsHeaders,
            body: JSON.stringify(result.data)
        };

    } catch (error) {
        // Captura qualquer erro de autenticação, cookie ou erro de API
        console.error(`Erro fatal na operação ${operation}:`, error.message);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: `Falha no Proxy Netlify: ${error.message}`,
                detalhe: "Verifique os logs de build e function no Netlify para detalhes sobre a falha do Node.js."
            })
        };
    }
};
