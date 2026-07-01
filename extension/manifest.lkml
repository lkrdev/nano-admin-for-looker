project_name: "nano_admin"

application: admin_extension {
  label: "Nano Admin Extension"
  url: "https://localhost:8080/bundle.js"
  
  entitlements: {
    use_embeds: no
    use_form_submit: yes
    local_storage: yes
    core_api_methods: ["me", "all_users", "user_roles"]
    scoped_user_attributes: ["nano_admin_challenge"]
    
    external_api_urls: [
      "http://localhost:8081",
      "https://localhost:8081"
    ]
  }
}
