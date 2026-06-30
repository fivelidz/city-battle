// CITY BATTLE — simple URP-compatible lit-ish shader that shows vertex colours.
// The terrain mesh stores elevation/slope/contour shading in vertex colours; this surfaces them
// with a cheap directional lambert term so relief reads on mobile.
Shader "CityBattle/TerrainVertexColor"
{
    Properties { _Tint ("Tint", Color) = (1,1,1,1) }
    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct A { float4 positionOS : POSITION; float3 normalOS : NORMAL; float4 color : COLOR; };
            struct V { float4 positionHCS : SV_POSITION; float3 normalWS : TEXCOORD0; float4 color : COLOR; };

            float4 _Tint;

            V vert (A v)
            {
                V o;
                o.positionHCS = TransformObjectToHClip(v.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.color = v.color;
                return o;
            }

            half4 frag (V i) : SV_Target
            {
                Light mainLight = GetMainLight();
                float ndl = saturate(dot(normalize(i.normalWS), mainLight.direction));
                float shade = lerp(0.75, 1.15, ndl);   // gentle relief lighting
                half3 col = i.color.rgb * _Tint.rgb * shade;
                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
