project_name: "nano_admin"

application: admin_extension {
  label: "Nano Admin Extension"
  url: "https://storage.googleapis.com/arg-nano-admin-nano-admin-extension/bundle.js"
  
  entitlements: {
    use_embeds: no
    use_form_submit: yes
    local_storage: yes
    navigation: yes
    core_api_methods: ["me", "all_users", "user_roles"]
    scoped_user_attributes: ["nano_admin_challenge"]
    global_user_attributes: ["id"]
    external_api_urls: [
      "https://nano-admin-backend-3k5u7zcrka-ue.a.run.app",
      "https://us-east1-arg-nano-admin.cloudfunctions.net/nano-admin-backend"
    ]
    oauth2_urls: [
      "https://nano-admin-backend-3k5u7zcrka-ue.a.run.app/oauth/authorize",
      "https://nano-admin-backend-3k5u7zcrka-ue.a.run.app/oauth/token",
      "https://us-east1-arg-nano-admin.cloudfunctions.net/nano-admin-backend/oauth/authorize",
      "https://us-east1-arg-nano-admin.cloudfunctions.net/nano-admin-backend/oauth/token"
    ]
  }
}
