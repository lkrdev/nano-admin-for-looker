project_name: "nano_admin"

application: admin_extension {
  label: "Nano Admin Extension"
  url: "https://storage.googleapis.com/<YOUR_GCS_BUCKET>/bundle.js"
  
  entitlements: {
    use_embeds: no
    use_form_submit: yes
    local_storage: yes
    navigation: yes
    core_api_methods: ["me", "all_users", "user_roles"]
    scoped_user_attributes: ["nano_admin_challenge"]
    global_user_attributes: ["id"]
    external_api_urls: [
      "https://<YOUR_CLOUD_FUNCTION_URL>"
    ]
    oauth2_urls: [
      "https://<YOUR_CLOUD_FUNCTION_URL>/oauth/authorize",
      "https://<YOUR_CLOUD_FUNCTION_URL>/oauth/token"
    ]
  }
}
